import { CHAT_QUICK_ACTION_SCENARIOS } from '../../components/chat/constants/guidedPromptScenarios';
import {
  buildGuidedPromptTemplate,
  getGuidedPromptKey,
} from '../../components/chat/utils/guidedPromptTemplates';
import type { ChatPromptDraft } from '../../utils/chatPromptDraft';

type Translator = (key: string, options?: Record<string, unknown>) => string;

const CREATE_APP_SCENARIO = CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'create-program');

export function createAppChatDraft(t: Translator): ChatPromptDraft {
  if (!CREATE_APP_SCENARIO) {
    throw new Error('Create app shortcut is unavailable');
  }

  const promptText = buildGuidedPromptTemplate(t, CREATE_APP_SCENARIO, CREATE_APP_SCENARIO.skills);
  return {
    input: '',
    attachedPrompt: {
      scenarioId: CREATE_APP_SCENARIO.id,
      scenarioIcon: CREATE_APP_SCENARIO.icon,
      scenarioTitle: t(CREATE_APP_SCENARIO.titleKey),
      promptText,
      localization: {
        promptKey: getGuidedPromptKey(CREATE_APP_SCENARIO),
        titleKey: CREATE_APP_SCENARIO.titleKey,
        skills: CREATE_APP_SCENARIO.skills,
      },
    },
  };
}
