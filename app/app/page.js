"use client";
import { useEffect, useState } from "react";
import roster from "../roster.json";

export default function Home() {
  const [ownerStats, setOwnerStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      const results = await Promise.all(
        roster.owners.map(async (owner) => {
          const playerStats = await Promise.all(
            owner.players.map(async (player) => {
              const group = player.stat === "HRA" ? "pitching" : "hitting";
              try {
                const res = await fetch(
                  `https://statsapi.mlb.com/api/v1/people/${player.mlbId}/stats?stats=season&season=2026&group=${group}`
                );
                const data = await res.json();
                const stats = data.stats?.[0]?.splits?.[0]?.stat;
                let value = 0;
                if (player.stat === "HR") value = stats?.homeRuns ?? 0;
                if (player.stat === "HRA") value = stats?.homeRunsAllowed ?? 0;
                if (player.stat === "HBP") value = stats?.hitByPitch ?? 0;
                return { ...player, value };
              } catch {
                return { ...player, value: 0 };
              }
            })
          );
          const total = playerStats.reduce((sum, p) => sum + p.value, 0);
          return { name: owner.name, total, players: playerStats };
        })
      );
      results.sort((a, b) => b.total - a.total);
      setOwnerStats(results);
      setLoading(false);
    }
    fetchStats();
  }, []);

  if (loading) return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <p className="text-xl animate-pulse">Loading stats...</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-4xl font-bold text-center text-yellow-400 mb-2">⚾ Dingers Only Tracker</h1>
      <p className="text-center text-gray-400 mb-10 text-sm">Live MLB stats • 2026 Season</p>

      <div className="max-w-4xl mx-auto space-y-8">
        {ownerStats.map((owner, i) => (
          <div key={owner.name} className="bg-gray-900 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {owner.name}
              </h2>
              <span className="text-3xl font-extrabold text-yellow-400">{owner.total}</span>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left pb-2">Player</th>
                  <th className="text-left pb-2">Pos</th>
                  <th className="text-left pb-2">Tracking</th>
                  <th className="text-right pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {owner.players.map((player) => (
                  <tr key={player.name} className="border-b border-gray-800 hover:bg-gray-800 transition">
                    <td className="py-2">{player.name}</td>
                    <td className="py-2 text-gray-400">{player.position}</td>
                    <td className="py-2 text-gray-400">{player.stat}</td>
                    <td className="py-2 text-right font-bold text-yellow-300">{player.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </main>
  );
}