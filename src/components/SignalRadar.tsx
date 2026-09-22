import type { KeyboardEvent } from "react";
import type { Signal } from "../types";

interface SignalRadarProps {
  primary: Signal[];
  secondary?: Signal[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

const CENTER_X = 180;
const CENTER_Y = 142;
const RADIUS = 98;

function point(index: number, count: number, scale: number) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return [CENTER_X + Math.cos(angle) * RADIUS * scale, CENTER_Y + Math.sin(angle) * RADIUS * scale] as const;
}

function polygonPoints(values: number[], count: number) {
  return Array.from({ length: count }, (_, index) => {
    const [x, y] = point(index, count, values[index] ?? 0);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export default function SignalRadar({ primary, secondary, selectedId, onSelect }: SignalRadarProps) {
  const count = Math.max(3, primary.length);
  const secondaryById = new Map(secondary?.map((signal) => [signal.id, signal]));
  const primaryValues = Array.from({ length: count }, (_, index) => primary[index]?.value ?? 0);
  const secondaryValues = Array.from({ length: count }, (_, index) => {
    const current = primary[index];
    return current ? secondaryById.get(current.id)?.value ?? 0 : 0;
  });

  const activate = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="radar-wrap">
      <svg className="signal-radar" viewBox="0 0 360 290" role="img" aria-label="文字信号雷达图">
        <title>文字信号雷达图</title>
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon key={ring} className="radar-ring" points={polygonPoints(Array(count).fill(ring), count)} />
        ))}
        {Array.from({ length: count }, (_, index) => {
          const [x, y] = point(index, count, 1);
          return <line key={index} className="radar-axis" x1={CENTER_X} y1={CENTER_Y} x2={x} y2={y} />;
        })}
        {secondary && <polygon className="radar-shape secondary" points={polygonPoints(secondaryValues, count)} />}
        <polygon className="radar-shape primary" points={polygonPoints(primaryValues, count)} />
        {primary.map((signal, index) => {
          const [x, y] = point(index, count, signal.value);
          const [labelX, labelY] = point(index, count, 1.19);
          const active = signal.id === selectedId;
          return (
            <g
              key={signal.id}
              className={`radar-node ${active ? "is-active" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${signal.label} ${Math.round(signal.value * 100)}%`}
              onClick={() => onSelect(signal.id)}
              onKeyDown={(event) => activate(event, signal.id)}
            >
              <circle cx={x} cy={y} r={active ? 5.5 : 4} />
              <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle">{String(index + 1).padStart(2, "0")}</text>
            </g>
          );
        })}
      </svg>
      <div className="radar-legend" aria-label="样本图例">
        <span><i className="legend-dot primary" />样本 A</span>
        {secondary && <span><i className="legend-dot secondary" />样本 B</span>}
      </div>
    </div>
  );
}
