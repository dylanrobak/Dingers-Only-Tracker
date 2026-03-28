"use client";
import { useEffect, useState } from "react";
import roster from "../roster.json";

const SEASON = 2026;
const MONTHLY_BONUS = 10;

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
  const [utActive, setUtActive] = useState({});
  const [loading, setLoading] = useState(true);

  const allPlayers = roster.owners.flatMap((o) => o.players);

  useEffect(() => {
    const init = {};
    roster.owners.forEach((owner) => {
      owner.players.forEach((p) => {
        if (p.position === "UT") init[`${owner.name}-${p.name}`] = false;
      });
    });
    setUtActive(init);
  }, []);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);

      // Fetch season stats for all players
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

      // Fetch monthly bonuses for completed months
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const completedMonths = MONTHS.filter((m) => m.num < currentMonth);
      const bonuses = {};

      for (const month of completedMonths) {
        // Fetch monthly HRs for all rostered players
        const monthlyHRs = await Promise.all(
          allPlayers.map(async (player) => {
            const hrs = await fetchPlayerMonthlyHR(player.mlbId, month.num);
            return { ...player, monthlyHR: hrs };
          })
        );

        const maxHR = Math.max(...monthlyHRs.map((p) => p.monthlyHR));
        if (maxHR === 0) continue;

        const leaders = monthlyHRs.filter((p) => p.monthlyHR === maxHR);
        const pointsEach = MONTHLY_BONUS / leaders.length;

        bonuses[month.name] = { leaders, pointsEach, maxHR, teamPoints: {} };

        roster.owners.forEach((owner) => {
          const ownerLeaders = leaders.filter((l) =>
            owner.players.some((p) => p.mlbId === l.mlbId)
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

  function getOwnerTotal(owner) {
    const playerTotal = owner.players.reduce((sum, p) => {
      const key = `${owner.name}-${p.name}`;
      if (p.position === "UT" && !utActive[key]) return sum;
      const val = p.stat === "HBP" ? p.value * 0.5 : p.value;
      return sum + val;
    }, 0);

    const bonusTotal = Object.values(monthlyBonuses).reduce((sum, month) => {
      return sum + (month.teamPoints[owner.name] ?? 0);
    }, 0);

    return playerTotal + bonusTotal;
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

      {/* Side by side team cards */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {sorted.map((owner, i) => {
          const total = getOwnerTotal(owner);
          const bonusTotal = Object.values(monthlyBonuses).reduce(
            (sum, m) => sum + (m.teamPoints[owner.name] ?? 0),
            0
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
                    const key = `${owner.name}-${player.name}`;
                    const isUT = player.position === "UT";
                    const isActive = !isUT || utActive[key];
                    const pts =
                      player.stat === "HBP"
                        ? player.value * 0.5
                        : player.value;
                    return (
                      <tr
                        key={player.name}
                        className={`border-b border-gray-800 transition ${
                          isUT && !isActive ? "opacity-40" : "hover:bg-gray-800"
                        }`}
                      >
                        <td className="py-2 flex items-center gap-2">
                          {player.name}
                          {isUT && (
                            <button
                              onClick={() =>
                                setUtActive((prev) => ({
                                  ...prev,
                                  [key]: !prev[key],
                                }))
                              }
                              className={`text-xs px-2 py-0.5 rounded-full border transition ${
                                isActive
                                  ? "border-yellow-400 text-yellow-400"
                                  : "border-gray-600 text-gray-500"
                              }`}
                            >
                              {isActive ? "Active" : "UT"}
                            </button>
                          )}
                        </td>
                        <td className="py-2 text-gray-400">{player.position}</td>
                        <td className="py-2 text-gray-400">{player.stat}</td>
                        <td className="py-2 text-right font-bold text-yellow-300">
                          {isUT && !isActive ? "-" : pts.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {bonusTotal > 0 && (
                <div className="text-sm text-green-400 text-right font-semibold">
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
                <th className="text-left pb-2">Leader(s)</th>
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
                          {team}: +{pts}
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
    </main>
  );
}