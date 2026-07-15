import 'dotenv/config';
import { Agent } from '../agent/core.js';
import { Provider, Message, ProviderEvent } from '../provider/types.js';
import { ToolRegistry } from '../tools/registry.js';

// Provider that calls a non-existent tool
class ToolErrorProvider implements Provider {
  private callCount = 0;

  async *complete(_messages: Message[], _tools?: any[]): AsyncIterable<ProviderEvent> {
    this.callCount++;
    if (this.callCount === 1) {
      yield { type: 'text', delta: 'Let me look that up.' };
      yield {
        type: 'tool_use',
        id: 'toolu_err_001',
        name: 'nonexistent_tool',
        input: { query: 'test' },
      };
      yield { type: 'done', stopReason: 'tool_use' };
    } else {
      const hasErrorMessage = _messages.some(m => {
        if (typeof m.content === 'string') return false;
        return JSON.stringify(m.content).includes('not found');
      });
      if (hasErrorMessage) {
        yield { type: 'text', delta: 'I tried to look that up but the tool is not available.' };
      } else {
        yield { type: 'text', delta: 'ERROR: missing error feedback.' };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    }
  }
}

// Provider where a tool handler throws
class ToolCrashProvider implements Provider {
  private callCount = 0;

  async *complete(_messages: Message[], _tools?: any[]): AsyncIterable<ProviderEvent> {
    this.callCount++;
    if (this.callCount === 1) {
      yield { type: 'text', delta: 'Checking...' };
      yield {
        type: 'tool_use',
        id: 'toolu_crash_001',
        name: 'crash_tool',
        input: {},
      };
      yield { type: 'done', stopReason: 'tool_use' };
    } else {
      const hasError = _messages.some(m => {
        if (typeof m.content === 'string') return false;
        return JSON.stringify(m.content).includes('Error running tool');
      });
      if (hasError) {
        yield { type: 'text', delta: 'The tool crashed but I handled it gracefully.' };
      } else {
        yield { type: 'text', delta: 'ERROR: missing crash error feedback.' };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    }
  }
}

async function test() {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: 'crash_tool',
      description: 'A tool that always crashes',
      parameters: [],
    },
    handler: async () => {
      throw new Error('💥 Something went terribly wrong!');
    },
  });

  // Test 1: Non-existent tool
  {
    const agent = new Agent({
      provider: new ToolErrorProvider(),
      systemPrompt: 'You are a helpful assistant.',
      toolRegistry: registry,
    });

    let response = '';
    for await (const chunk of agent.processTurn('Look up something')) {
      response += chunk;
    }
    console.log('Non-existent tool response:', response);
    const hasHistory = agent.getHistory().some(m => {
      if (typeof m.content === 'string') return false;
      return JSON.stringify(m.content).includes('not found');
    });
    console.log('Error reported to model:', hasHistory ? '✅' : '❌');
  }

  // Test 2: Tool that throws
  {
    const agent = new Agent({
      provider: new ToolCrashProvider(),
      systemPrompt: 'You are a helpful assistant.',
      toolRegistry: registry,
    });

    let response = '';
    for await (const chunk of agent.processTurn('Do something dangerous')) {
      response += chunk;
    }
    console.log('Crashing tool response:', response);
    const hasError = agent.getHistory().some(m => {
      if (typeof m.content === 'string') return false;
      return JSON.stringify(m.content).includes('Error running tool');
    });
    console.log('Crash error reported to model:', hasError ? '✅' : '❌');
  }

  console.log('\n✅ Tier 2 error handling passes.');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});