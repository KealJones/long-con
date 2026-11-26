// A small SVG line chart of complete recall against mean packet tokens, for the recall report.

export interface Series {
  name: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

const COLORS = ["#2a6fdb", "#2a6fdb", "#d9622b", "#d9622b", "#3a9a5b", "#3a9a5b"];

export function recallChart(series: Series[], xMax = 8000): string {
  const W = 640, H = 380, L = 56, R = 170, T = 24, B = 48;
  const px = (x: number) => L + (Math.min(x, xMax) / xMax) * (W - L - R);
  const py = (y: number) => T + (1 - y) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(
    (y) => `<line x1="${L}" x2="${W - R}" y1="${py(y)}" y2="${py(y)}" stroke="#8884" /><text x="${L - 8}" y="${py(y) + 4}" text-anchor="end">${y * 100}%</text>`,
  );
  const ticks = [0, 2000, 4000, 6000, 8000].map((x) => `<text x="${px(x)}" y="${H - B + 18}" text-anchor="middle">${x / 1000}K</text>`);
  const lines = series.map((s, i) => {
    const color = COLORS[i % COLORS.length];
    const d = s.points.map((p, j) => `${j ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
    const dots = s.points.map((p) => `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3" fill="${color}" />`).join("");
    const ly = T + 14 + i * 20;
    const legend = `<line x1="${W - R + 14}" x2="${W - R + 38}" y1="${ly - 4}" y2="${ly - 4}" stroke="${color}" stroke-width="2"${s.dashed ? ' stroke-dasharray="5 4"' : ""} /><text x="${W - R + 44}" y="${ly}">${s.name}</text>`;
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${s.dashed ? ' stroke-dasharray="5 4"' : ""} />${dots}${legend}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12" fill="#888">
<rect width="${W}" height="${H}" fill="none" />
${grid.join("\n")}
${ticks.join("\n")}
<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">Mean packet tokens</text>
<text x="14" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">All evidence in packet</text>
${lines.join("\n")}
</svg>
`;
}
