import { useState, useMemo, memo } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import AssistantMessageItem from '@/components/features/timeline/assistant-message-item';
import ToolGroupItem from '@/components/features/timeline/tool-group-item';
import PlanItem from '@/components/features/timeline/plan-item';
import type {
  ITimelineAgentGroup,
  ITimelineEntry,
  ITimelineToolCall,
  ITimelineToolResult,
} from '@/types/timeline';

type TGroupedItem =
  | { type: 'entry'; id: string; entry: ITimelineEntry }
  | { type: 'tool-group'; id: string; toolCalls: ITimelineToolCall[]; toolResults: ITimelineToolResult[] };

const groupEntries = (entries: ITimelineEntry[]): TGroupedItem[] => {
  const result: TGroupedItem[] = [];
  let toolCallBuffer: ITimelineToolCall[] = [];
  let toolResultBuffer: ITimelineToolResult[] = [];

  const flush = () => {
    if (toolCallBuffer.length > 0) {
      result.push({
        type: 'tool-group',
        id: toolCallBuffer[0].id,
        toolCalls: [...toolCallBuffer],
        toolResults: [...toolResultBuffer],
      });
      toolCallBuffer = [];
      toolResultBuffer = [];
    }
  };

  for (const entry of entries) {
    if (entry.type === 'tool-call') {
      toolCallBuffer.push(entry);
    } else if (entry.type === 'tool-result') {
      toolResultBuffer.push(entry);
    } else if (entry.type === 'assistant-message' || entry.type === 'plan') {
      flush();
      result.push({ type: 'entry', id: entry.id, entry });
    }
  }

  flush();
  return result;
};

const AgentEntryRenderer = ({ entry }: { entry: ITimelineEntry }) => {
  switch (entry.type) {
    case 'assistant-message':
      return <AssistantMessageItem entry={entry} />;
    case 'plan':
      return <PlanItem entry={entry} />;
    default:
      return null;
  }
};

interface IAgentGroupItemProps {
  entry: ITimelineAgentGroup;
}

const AgentGroupItem = ({ entry }: IAgentGroupItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const groupedItems = useMemo(() => groupEntries(entry.entries), [entry.entries]);
  const hasEntries = groupedItems.length > 0;

  return (
    <div className="animate-in fade-in duration-150">
      <button
        className={cn(
          'flex w-full items-center gap-1.5 py-1 text-xs text-muted-foreground transition-colors',
          hasEntries && 'hover:text-foreground',
        )}
        onClick={() => hasEntries && setIsExpanded((prev) => !prev)}
        disabled={!hasEntries}
      >
        <ChevronRight
          size={14}
          className={cn(
            'shrink-0 transition-transform duration-150',
            isExpanded && 'rotate-90',
          )}
        />
        <Users size={12} className="shrink-0 text-agent-active/70" />
        <span className="shrink-0 font-medium text-agent-active">Sub-agent</span>
        <span className="shrink-0 text-muted-foreground/70">{entry.agentType}</span>
        <span className="min-w-0 truncate">{entry.description}</span>
      </button>
      {isExpanded && (
        <div className="ml-[7px] mt-0.5 border-l border-border/40 pl-3">
          {groupedItems.map((item) => (
            <div key={item.id} className="py-0.5">
              {item.type === 'tool-group' ? (
                <ToolGroupItem toolCalls={item.toolCalls} toolResults={item.toolResults} />
              ) : (
                <AgentEntryRenderer entry={item.entry} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(AgentGroupItem);
