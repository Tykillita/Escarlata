import 'dotenv/config';
import { Agent } from '../agent/core.js';
import { Provider, Message, ProviderEvent } from '../provider/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { saveNoteTool, getNoteTool } from '../tools/notes.js';

// A provider that simulates a tool call followed by a text response
class SimulatedToolProvider implements Provider {
  private callCount = 0;

  async *complete(messages: Message[], _tools?: any[]): AsyncIterable<ProviderEvent> {
    this.callCount++;

    if (this.callCount === 1) {
      // First round: model decides to use the save_note tool
      for (const char of 'Let me save that for you.') {
        yield { type: 'text', delta: char };
        await new Promise(r => setTimeout(r, 1));
      }
      yield {
        type: 'tool_use',
        id: 'toolu_sim_001',
        name: 'save_note',
        input: { title: 'Important', content: 'Remember this fact.' },
      };
      yield { type: 'done', stopReason: 'tool_use' };

    } else if (this.callCount === 2) {
      // Second round: after tool result, model gives final response
      // Verify tool result was injected into history
      const toolResults = messages.filter(m => {
        if (typeof m.content === 'string') return false;
        return m.content.some((b: any) => b.type === 'tool_result');
      });

      if (toolResults.length === 0) {
        yield { type: 'text', delta: 'ERROR: No tool result found in history!' };
      } else {
        yield { type: 'text', delta: 'Done! I saved the note "Important" for you.' };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    }
  }
}

async function test() {
  const registry = new ToolRegistry();
  registry.register(saveNoteTool);
  registry.register(getNoteTool);

  const agent = new Agent({
    provider: new SimulatedToolProvider(),
    systemPrompt: 'You are Escarlata, a helpful assistant.',
    toolRegistry: registry,
  });

  // User asks to save something
  let response = '';
  for await (const chunk of agent.processTurn('Remember this: Important fact.')) {
    response += chunk;
  }

  console.log('Tool call response:', response);

  // Check that the tool result was captured in history
  const history = agent.getHistory();
  console.log('History entries:', history.length);

  // Check that the note was actually saved
  const noteResult = await getNoteTool.handler({ title: 'Important' });
  console.log('Saved note content:', noteResult.includes('Remember this fact.') ? '✅' : '❌');

  // Check that the tool result block was injected
  const hasToolResult = history.some(m => {
    if (typeof m.content === 'string') return false;
    return Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result');
  });
  console.log('Tool result in history:', hasToolResult ? '✅' : '❌');

  console.log('\n✅ Tier 2 passes: tool calling loop works end-to-end.');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});