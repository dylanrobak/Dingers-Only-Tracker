"use client";
import { useEffect, useState } from "react";
import roster from "../roster.json";
import { supabase } from "./supabase";

const SEASON = 2026;
const MONTHLY_BONUS = 10;
const SWAP_PASSWORD = "dingers2026";

const MONTHS = [
  { name: "April", num: 4 },
  { name: "May", num: 5 },
  { name: "June", num: 6 },
  { name: "July", num: 7 },
  { name: "August", num: 8 },
  { name: "September", num: 9 },
];

function getStatValue(stats, statType) {
  if (!stats) return 0;
  if (statType === "HR") return stats.homeRuns ?? 0;
  if (statType === "HRA") return stats.homeRuns ?? 0;
  if (statType === "HBP") return stats.hitByPitch ?? 0;
  return 0;
}

async function fetchPlayerSeasonStats(mlbId, group) {
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=season&season=${SEASON}&group=${group}`
    );
    const data = await res.json();
    return data.stats?.[0]?.splits?.[0]?.stat ?? null;
  } catch {
    return null;
  }
}

async function fetchPlayerMonthlyHR(mlbId, month) {
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=byMonth&season=${SEASON}&group=hitting`
    );
    const data = await res.json();
    const splits = data.stats?.[0]?.splits ?? [];
    const monthSplit = splits.find((s) => parseInt(s.month) === month);
    return monthSplit?.stat?.homeRuns ?? 0;
  } catch {
    return 0;
  }
}

export default function Home() {
  const [ownerStats, setOwnerStats] = useState([]);
  const [monthlyBonuses, setMonthlyBonuses] = useState({});
  const [swapHistory, setSwapHistory] = useState([]);
  const [benchedPlayer, setBenchedPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [swapModal, setSwapModal] = useState(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [selectedBench, setSelectedBench] = useState({});

  const allPlayers = roster.owners.flatMap((o) => o.players);

  // Load swap history from Supabase
  useEffect(() => {
    async function loadSwaps() {
      const { data } = await supabase
        .from("swaps")
        .select("*")
        .order("swap_date", { ascending: true });
      if (data) setSwapHistory(data);
    }
    loadSwaps();
  }, []);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);

      const playerResults = await Promise.all(
        roster.owners.map(async (owner) => {
          const players = await Promise.all(
            owner.players.map(async (player) => {
              const group = player.stat === "HRA" ? "pitching" : "hitting";
              const stats = await fetchPlayerSeasonStats(player.mlbId, group);
              const value = getStatValue(stats, player.stat);
              return { ...player, value, ownerName: owner.name };
            })
          );
          return { ...owner, players };
        })
      );

      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const completedMonths = MONTHS.filter((m) => m.num < currentMonth);
      const bonuses = {};

      for (const month of completedMonths) {
        let mlbMaxHR = 0;
        let mlbLeaderIds = [];

        try {
          const leaderRes = await fetch(
            `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=homeRuns&season=${SEASON}&leaderGameTypes=R&statGroup=hitting&limit=50`
          );
          const leaderData = await leaderRes.json();
          const topPlayers = leaderData.leagueLeaders?.[0]?.leaders ?? [];

          const topMonthlyHRs = await Promise.all(
            topPlayers.map(async (p) => {
              const hrs = await fetchPlayerMonthlyHR(p.person.id, month.num);
              return { mlbId: String(p.person.id), name: p.person.fullName, monthlyHR: hrs };
            })
          );

          mlbMaxHR = Math.max(...topMonthlyHRs.map((p) => p.monthlyHR));
          mlbLeaderIds = topMonthlyHRs.filter((p) => p.monthlyHR === mlbMaxHR);
        } catch {
          mlbMaxHR = 0;
        }

        if (mlbMaxHR === 0) continue;

        const totalLeaders = mlbLeaderIds.length;
        const pointsEach = MONTHLY_BONUS / totalLeaders;

        const rosteredLeaders = mlbLeaderIds.filter((leader) =>
          allPlayers.some((p) => String(p.mlbId) === String(leader.mlbId))
        );

        bonuses[month.name] = {
          leaders: mlbLeaderIds,
          rosteredLeaders,
          pointsEach,
          maxHR: mlbMaxHR,
          teamPoints: {},
          void: rosteredLeaders.length === 0,
        };

        roster.owners.forEach((owner) => {
          const ownerLeaders = rosteredLeaders.filter((l) =>
            owner.players.some((p) => String(p.mlbId) === String(l.mlbId))
          );
          if (ownerLeaders.length > 0) {
            bonuses[month.name].teamPoints[owner.name] =
              ownerLeaders.length * pointsEach;
          }
        });
      }

      setOwnerStats(playerResults);
      setMonthlyBonuses(bonuses);
      setLoading(false);
    }

    fetchAll();
  }, []);

  // Calculate adjusted HR value based on swap history
  function getAdjustedValue(player, ownerName) {
    if (player.stat !== "HR" && player.stat !== "HBP") return player.value;

    const teamSwaps = swapHistory.filter((s) => s.team_name === ownerName);
    if (teamSwaps.length === 0) return player.value;

    const utPlayer = roster.owners
      .find((o) => o.name === ownerName)
      ?.players.find((p) => p.position === "UT");

    let adjustedValue = player.value;

    for (const swap of teamSwaps) {
      if (player.name === swap.ut_player) {
        // UT player only counts HRs above their baseline at swap time
        adjustedValue = Math.max(0, player.value - swap.ut_baseline);
      } else if (player.name === swap.benched_player) {
        // Benched player's value freezes at their baseline
        adjustedValue = swap.benched_baseline;
      }
    }

    return adjustedValue;
  }

  function getOwnerTotal(owner) {
    const teamSwaps = swapHistory.filter((s) => s.team_name === owner.name);
    const activeSwap = teamSwaps[teamSwaps.length - 1];
    const isUtActive = !!activeSwap;
    const benchedName = activeSwap?.benched_player;

    const playerTotal = owner.players.reduce((sum, p) => {
      if (p.position === "UT" && !isUtActive) return sum;
      const adjusted = getAdjustedValue(p, owner.name);
      const val = p.stat === "HBP" ? adjusted * 0.5 : p.stat === "HRA" ? adjusted * 0.25 : adjusted;
      return sum + val;
    }, 0);

    const bonusTotal = Object.values(monthlyBonuses).reduce((sum, month) => {
      return sum + (month.teamPoints[owner.name] ?? 0);
    }, 0);

    return playerTotal + bonusTotal;
  }

  async function handleRecordSwap(owner) {
    if (password !== SWAP_PASSWORD) {
      setPasswordError(true);
      return;
    }

    const utPlayer = owner.players.find((p) => p.position === "UT");
    const benchName = selectedBench[owner.name];
    const benchPlayer = owner.players.find((p) => p.name === benchName);

    if (!utPlayer || !benchPlayer) return;

    // Get current HR totals as baselines
    const utStats = await fetchPlayerSeasonStats(utPlayer.mlbId, "hitting");
    const utBaseline = utStats?.homeRuns ?? 0;

    const benchStats = await fetchPlayerSeasonStats(benchPlayer.mlbId, "hitting");
    const benchBaseline = benchStats?.homeRuns ?? 0;

    // Mark previous swaps for this team as inactive
    await supabase
      .from("swaps")
      .update({ active: false })
      .eq("team_name", owner.name);

    // Insert new swap
    const { error } = await supabase.from("swaps").insert({
      team_name: owner.name,
      ut_player: utPlayer.name,
      benched_player: benchName,
      swap_date: new Date().toISOString(),
      ut_baseline: utBaseline,
      benched_baseline: benchBaseline,
      active: true,
    });

    if (!error) {
      const { data } = await supabase
        .from("swaps")
        .select("*")
        .order("swap_date", { ascending: true });
      if (data) setSwapHistory(data);
      setSwapModal(null);
      setPassword("");
      setPasswordError(false);
      setSelectedBench({});
    }
  }

async function handleDeactivateSwap(ownerName) {
    if (password !== SWAP_PASSWORD) {
      setPasswordError(true);
      return;
    }

    await supabase
      .from("swaps")
      .delete()
      .eq("team_name", ownerName);

    const { data } = await supabase
      .from("swaps")
      .select("*")
      .order("swap_date", { ascending: true });
    if (data) setSwapHistory(data);
    setSwapModal(null);
    setPassword("");
    setPasswordError(false);
  }
  const sorted = [...ownerStats].sort(
    (a, b) => getOwnerTotal(b) - getOwnerTotal(a)
  );

  const medals = ["🥇", "🥈", "🥉"];

  if (loading)
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-xl animate-pulse">Loading stats...</p>
      </main>
    );

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-4xl font-bold text-center text-yellow-400 mb-2">
        ⚾ Dingers Only Tracker
      </h1>
      <p className="text-center text-gray-400 mb-10 text-sm">
        Live MLB stats • {SEASON} Season
      </p>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {sorted.map((owner, i) => {
          const total = getOwnerTotal(owner);
          const bonusTotal = Object.values(monthlyBonuses).reduce(
            (sum, m) => sum + (m.teamPoints[owner.name] ?? 0),
            0
          );
          const teamSwaps = swapHistory.filter((s) => s.team_name === owner.name);
          const activeSwap = teamSwaps[teamSwaps.length - 1];
          const isUtActive = !!activeSwap;
          const benchedName = activeSwap?.benched_player;
          const eligibleToBench = owner.players.filter(
            (p) => p.position !== "UT" && p.stat !== "HRA"
          );

          return (
            <div key={owner.name} className="bg-gray-900 rounded-2xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">
                  {medals[i]} {owner.name}
                </h2>
                <span className="text-3xl font-extrabold text-yellow-400">
                  {total.toFixed(1)}
                </span>
              </div>

              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left pb-2">Player</th>
                    <th className="text-left pb-2">Pos</th>
                    <th className="text-left pb-2">Stat</th>
                    <th className="text-right pb-2">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {owner.players.map((player) => {
                    const isUT = player.position === "UT";
                    const isBenched = player.name === benchedName;
                    const isInactive = (isUT && !isUtActive) || isBenched;
                    const adjusted = getAdjustedValue(player, owner.name);
                    const pts = player.stat === "HBP" ? adjusted * 0.5 : player.stat === "HRA" ? adjusted * 0.25 : adjusted;

                    return (
                      <tr
                        key={player.name}
                        className={`border-b border-gray-800 transition ${
                          isInactive ? "opacity-40" : "hover:bg-gray-800"
                        }`}
                      >
                        <td className="py-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {player.name}
                            {isUT && isUtActive && (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-yellow-400 text-yellow-400">
                                Active
                              </span>
                            )}
                            {isUT && !isUtActive && (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-gray-600 text-gray-500">
                                UT
                              </span>
                            )}
                            {isBenched && (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-red-500 text-red-400">
                                Benched
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 text-gray-400">{player.position}</td>
                        <td className="py-2 text-gray-400">{player.stat}</td>
                        <td className="py-2 text-right font-bold text-yellow-300">
                          {isInactive ? "-" : pts.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Swap controls */}
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => setSwapModal({ owner, mode: isUtActive ? "deactivate" : "activate" })}
                  className={`text-xs px-4 py-1.5 rounded-full border transition ${
                    isUtActive
                      ? "border-red-500 text-red-400 hover:bg-red-950"
                      : "border-yellow-500 text-yellow-400 hover:bg-yellow-950"
                  }`}
                >
                  {isUtActive ? "Swap Out UT" : "Swap In UT"}
                </button>
              </div>

              {/* Swap history */}
              {teamSwaps.length > 0 && (
                <div className="mt-4 border-t border-gray-700 pt-3">
                  <p className="text-xs text-gray-500 mb-2">Swap History</p>
                  {teamSwaps.map((swap, idx) => (
                    <div key={swap.id} className="text-xs text-gray-400 mb-1">
                      #{idx + 1} — {new Date(swap.swap_date).toLocaleDateString()} — {swap.ut_player} in (baseline: {swap.ut_baseline} HR), {swap.benched_player} out (frozen: {swap.benched_baseline} HR)
                    </div>
                  ))}
                </div>
              )}

              {bonusTotal > 0 && (
                <div className="text-sm text-green-400 text-right font-semibold mt-3">
                  +{bonusTotal} bonus pts
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Monthly bonus breakdown */}
      {Object.keys(monthlyBonuses).length > 0 && (
        <div className="max-w-6xl mx-auto bg-gray-900 rounded-2xl p-6 shadow-lg">
          <h2 className="text-xl font-bold text-yellow-400 mb-4">
            🏆 Monthly HR Bonus
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left pb-2">Month</th>
                <th className="text-left pb-2">MLB Leader(s)</th>
                <th className="text-left pb-2">HRs</th>
                <th className="text-right pb-2">Bonus Awarded</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(monthlyBonuses).map(([month, data]) => (
                <tr key={month} className="border-b border-gray-800">
                  <td className="py-2 font-semibold">{month}</td>
                  <td className="py-2 text-gray-300">
                    {data.leaders.map((l) => l.name).join(", ")}
                  </td>
                  <td className="py-2 text-gray-400">{data.maxHR}</td>
                  <td className="py-2 text-right">
                    {Object.entries(data.teamPoints).length === 0 ? (
                      <span className="text-gray-500">Void</span>
                    ) : (
                      Object.entries(data.teamPoints).map(([team, pts]) => (
                        <div key={team} className="text-green-400">
                          {team}: +{pts.toFixed(1)}
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Swap Modal */}
      {swapModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-yellow-400 mb-4">
              {swapModal.mode === "activate" ? "Swap In UT Player" : "Swap Out UT Player"}
            </h3>

            {swapModal.mode === "activate" && (
              <div className="mb-4">
                <p className="text-sm text-gray-400 mb-2">Select player to bench:</p>
                <div className="flex flex-wrap gap-2">
                  {swapModal.owner.players
                    .filter((p) => p.position !== "UT" && p.stat !== "HRA")
                    .map((p) => (
                      <button
                        key={p.name}
                        onClick={() =>
                          setSelectedBench((prev) => ({
                            ...prev,
                            [swapModal.owner.name]: p.name,
                          }))
                        }
                        className={`text-xs px-3 py-1 rounded-full border transition ${
                          selectedBench[swapModal.owner.name] === p.name
                            ? "border-red-500 text-red-400 bg-red-950"
                            : "border-gray-600 text-gray-400 hover:border-gray-400"
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <p className="text-sm text-gray-400 mb-2">Enter password:</p>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(false);
                }}
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-2 text-sm border border-gray-700 focus:outline-none focus:border-yellow-400"
                placeholder="Password"
              />
              {passwordError && (
                <p className="text-red-400 text-xs mt-1">Incorrect password</p>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setSwapModal(null);
                  setPassword("");
                  setPasswordError(false);
                }}
                className="text-sm px-4 py-2 rounded-full border border-gray-600 text-gray-400 hover:border-gray-400 transition"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  swapModal.mode === "activate"
                    ? handleRecordSwap(swapModal.owner)
                    : handleDeactivateSwap(swapModal.owner.name)
                }
                className="text-sm px-4 py-2 rounded-full border border-yellow-500 text-yellow-400 hover:bg-yellow-950 transition"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}