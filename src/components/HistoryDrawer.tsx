import { Clock3, Download, FileClock, Trash2, X } from "lucide-react";
import type { HistoryEntry, Lens } from "../types";

interface HistoryDrawerProps {
  open: boolean;
  entries: HistoryEntry[];
  onClose: () => void;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
}

const LENS_LABELS: Record<Lens, string> = { message: "消息", pitch: "提案", story: "故事" };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function HistoryDrawer({ open, entries, onClose, onSelect, onDelete, onExport }: HistoryDrawerProps) {
  return (
    <>
      <button className={`drawer-backdrop ${open ? "is-open" : ""}`} type="button" onClick={onClose} aria-label="关闭观测档案" tabIndex={open ? 0 : -1} />
      <aside className={`history-drawer ${open ? "is-open" : ""}`} aria-hidden={!open} aria-label="观测档案">
        <div className="drawer-heading">
          <div><span>LOCAL ARCHIVE</span><h2>观测档案</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <div className="drawer-toolbar">
          <span>最近 {entries.length} / 8 条</span>
          <button type="button" onClick={onExport} disabled={entries.length === 0}><Download size={15} /> 导出全部</button>
        </div>
        <div className="history-list">
          {entries.length === 0 ? (
            <div className="history-empty"><FileClock size={30} /><span>档案仍是空白</span></div>
          ) : entries.map((entry, index) => (
            <article className="history-item" key={entry.id}>
              <button className="history-load" type="button" onClick={() => onSelect(entry)}>
                <span className="history-meta"><b>{String(index + 1).padStart(2, "0")} · {LENS_LABELS[entry.lens]}</b><i><Clock3 size={13} /> {formatDate(entry.createdAt)}</i></span>
                <p>{entry.text}</p>
                <span className="history-foot">{entry.comparisonText ? "A / B 对照" : "单样本"}<b>{entry.primary.signals.length} 个信号</b></span>
              </button>
              <button className="history-delete" type="button" onClick={() => onDelete(entry.id)} title="删除记录" aria-label="删除记录"><Trash2 size={15} /></button>
            </article>
          ))}
        </div>
      </aside>
    </>
  );
}
