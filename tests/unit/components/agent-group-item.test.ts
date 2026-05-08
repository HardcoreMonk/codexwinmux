import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AgentGroupItem from '@/components/features/timeline/agent-group-item';
import type { ITimelineAgentGroup } from '@/types/timeline';

const entry: ITimelineAgentGroup = {
  id: 'agent-group-a',
  type: 'agent-group',
  timestamp: 1,
  agentType: 'explorer',
  description: 'Map timeline parser callers',
  entryCount: 2,
  entries: [],
};

describe('AgentGroupItem', () => {
  it('renders the sub-agent relationship label and agent type', () => {
    const markup = renderToStaticMarkup(React.createElement(AgentGroupItem, { entry }));

    expect(markup).toContain('Sub-agent');
    expect(markup).toContain('explorer');
    expect(markup).toContain('Map timeline parser callers');
  });
});
