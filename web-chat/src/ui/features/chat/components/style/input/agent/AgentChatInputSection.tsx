import { useEffect, useRef, useState, type ReactNode } from 'react';
import { uploadedAttachmentToMessageAttachment } from '../../../../attachments/AttachmentUtils';
import { AttachmentChip } from '../../../AttachmentChip';
import { AttachmentSelector } from '../../../AttachmentSelector';
import { FullscreenInputDialog } from '../../../FullscreenInputDialog';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DataObjectIcon,
  FullscreenIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  LockIcon,
  PersonIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  StopIcon,
  TuneIcon
} from '../../../../util/chatIcons';
import { InputOverlayPopup } from '../common/InputOverlayPopup';
import { CharacterCardModelBindingSwitchConfirmDialog } from '../common/CharacterCardModelBindingSwitchConfirmDialog';
import { PendingMessageQueuePanel } from '../common/PendingMessageQueuePanel';
import { ThinkingQualitySlider } from '../common/ThinkingQualitySlider';
import type {
  InputProcessingStage,
  PendingQueueMessageItem,
  WebInputSettingsState,
  WebMemorySelectorState,
  WebModelSelectorConfig,
  WebModelSelectorState,
  WebSelectModelResponse,
  WebThinkingQualityMapping,
  WebThemeSnapshot,
  WebUploadedAttachment
} from '../../../../util/chatTypes';

type InfoContent = {
  title: string;
  description: string;
};

type IconComponent = (props: { size?: number }) => ReactNode;
type PendingSelection = {
  configId: string;
  modelIndex: number;
};

const AUTO_GLM_WARNING =
  'Do not use autoglm as the main chat model. The chat model and the UI controller model are separate; choose any other capable LLM. If in doubt, read the documentation on how model configuration works.';

const INFO_COPY = {
  thinkingSettings: {
    title: 'Thinking',
    description: 'Manage thinking mode'
  },
  thinkingMode: {
    title: 'Thinking mode',
    description: 'Currently supports Gemini, Qwen3, Claude, Doubao, NVIDIA, SiliconFlow and local MNN models, enabling built-in thinking.'
  },
  thinkingQuality: {
    title: 'Thinking level',
    description: 'Only applies in thinking mode; available levels follow the current model configuration.'
  },
  maxMode: {
    title: 'Max mode',
    description: 'Uses a larger context window when enabled.'
  },
  memory: {
    title: 'Memory',
    description: 'Switch the memory configuration used by the current chat.'
  },
  memoryAutoUpdate: {
    title: 'Auto-save memory',
    description: 'When enabled, candidate content is added to the long-term memory queue after each reply.'
  },
  manualMemoryUpdate: {
    title: 'Update memory now',
    description: 'Save memory from the current chat right now.'
  },
  autoRead: {
    title: 'Auto read aloud',
    description: 'Read new replies aloud automatically.'
  },
  autoApprove: {
    title: 'Auto approve',
    description: 'When enabled, all tool calls run directly without a confirmation prompt.'
  },
  disableGroup: {
    title: 'Disable options',
    description: 'Manage the switches that disable features affecting replies.'
  },
  disableStream: {
    title: 'Disable streaming',
    description: 'When disabled, AI replies appear all at once instead of streaming word by word.'
  },
  disableTools: {
    title: 'Disable tools',
    description: 'When disabled, the AI cannot call built-in tools, including memory queries.'
  },
  disablePreferenceDescription: {
    title: 'Disable user preference description',
    description: 'When disabled, the User preference description section is no longer appended to the system prompt.'
  }
} as const;

function configModelSummary(config: WebModelSelectorConfig) {
  if (config.models.length > 1) {
    return `${config.models.length} models`;
  }
  return config.model_name || 'None selected';
}

function processingLabel(stage: InputProcessingStage) {
  if (stage === 'connecting') return 'Syncing chat and theme';
  if (stage === 'uploading') return 'Uploading attachments';
  if (stage === 'streaming') return 'Receiving reply';
  return '';
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function AgentInfoButton({
  onClick
}: {
  onClick: () => void;
}) {
  return (
    <button
      className="agent-settings-info-button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      type="button"
    >
      <InfoIcon size={16} />
    </button>
  );
}

function AgentInfoSpacer() {
  return <span aria-hidden="true" className="agent-settings-info-spacer" />;
}

function AgentSettingsRow({
  children,
  className,
  onClick
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <div
        className={joinClasses('agent-settings-row', className)}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
      >
        {children}
      </div>
    );
  }

  return <div className={joinClasses('agent-settings-row', className)}>{children}</div>;
}

function AgentSwitch({
  checked
}: {
  checked: boolean;
}) {
  return (
    <span className={joinClasses('agent-settings-switch', checked && 'is-checked')}>
      <span className="agent-settings-switch-thumb" />
    </span>
  );
}

function AgentSimpleToggleSettingItem({
  checked,
  icon: Icon,
  onInfoClick,
  onToggle,
  title
}: {
  checked: boolean;
  icon: IconComponent;
  onInfoClick: () => void;
  onToggle: () => void;
  title: string;
}) {
  return (
    <AgentSettingsRow onClick={onToggle}>
      <span className={joinClasses('agent-settings-icon', checked && 'is-active')}>
        <Icon size={16} />
      </span>
      <AgentInfoButton onClick={onInfoClick} />
      <AgentInfoSpacer />
      <span className="agent-settings-title">{title}</span>
      <AgentSwitch checked={checked} />
    </AgentSettingsRow>
  );
}

function AgentActionSettingItem({
  icon: Icon,
  onClick,
  onInfoClick,
  title
}: {
  icon: IconComponent;
  onClick: () => void;
  onInfoClick: () => void;
  title: string;
}) {
  return (
    <AgentSettingsRow onClick={onClick}>
      <span className="agent-settings-icon">
        <Icon size={16} />
      </span>
      <AgentInfoButton onClick={onInfoClick} />
      <AgentInfoSpacer />
      <span className="agent-settings-title">{title}</span>
    </AgentSettingsRow>
  );
}

function AgentModelSelectorItem({
  allowCollapse = true,
  expanded,
  loading,
  onExpandedChange,
  onInfoClick,
  onSelectModel,
  selector
}: {
  allowCollapse?: boolean;
  expanded: boolean;
  loading: boolean;
  onExpandedChange: (value: boolean) => void;
  onInfoClick: () => void;
  onSelectModel: (
    configId: string,
    modelIndex: number,
    confirmCharacterCardSwitch?: boolean
  ) => Promise<WebSelectModelResponse | null>;
  selector: WebModelSelectorState | null;
}) {
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const currentModelName = selector?.current_model_name?.trim() || 'None selected';

  useEffect(() => {
    if (!expanded) {
      setExpandedConfigId(null);
    }
  }, [expanded]);

  async function runSelection(configId: string, modelIndex: number, confirmCharacterCardSwitch = false) {
    const response = await onSelectModel(configId, modelIndex, confirmCharacterCardSwitch);
    if (!response) {
      return;
    }

    if (response.requires_character_card_switch_confirmation) {
      setPendingSelection({ configId, modelIndex });
      return;
    }

    if (response.success) {
      setPendingSelection(null);
      setLocalMessage(null);
      setExpandedConfigId(null);
      if (allowCollapse) {
        onExpandedChange(false);
      }
    }
  }

  async function handleSelect(config: WebModelSelectorConfig, modelIndex: number) {
    const modelNameValue = config.models[modelIndex] ?? '';
    if (modelNameValue.toLowerCase().includes('autoglm')) {
      setLocalMessage(AUTO_GLM_WARNING);
      return;
    }

    await runSelection(config.id, modelIndex, false);
  }

  return (
    <>
      <div className="agent-model-selector">
        <AgentSettingsRow onClick={allowCollapse ? () => onExpandedChange(!expanded) : undefined}>
          <span className="agent-settings-icon">
            <DataObjectIcon size={16} />
          </span>
          <AgentInfoButton onClick={onInfoClick} />
          <AgentInfoSpacer />
          <span className="agent-settings-summary">
            <strong>Model:</strong>
            <span className="agent-settings-summary-value">{currentModelName}</span>
          </span>
          {allowCollapse ? (
            <span className="agent-settings-chevron">
              {expanded ? <ChevronUpIcon size={20} /> : <ChevronDownIcon size={20} />}
            </span>
          ) : null}
        </AgentSettingsRow>

        {expanded ? (
          <div className="agent-model-selector-body">
            {loading ? <div className="agent-model-selector-empty">Loading model configurations...</div> : null}

            {!loading && !selector?.configs.length ? (
              <div className="agent-model-selector-empty">No models available</div>
            ) : null}

            {!loading
              ? selector?.configs.map((config) => {
                  const isSelected = config.selected;
                  const hasMultipleModels = config.models.length > 1;
                  const isExpanded = expandedConfigId === config.id;

                  return (
                    <div className="agent-model-selector-config-block" key={config.id}>
                      <button
                        className={joinClasses(
                          'agent-model-selector-config-row',
                          isSelected && 'is-selected'
                        )}
                        onClick={() => {
                          if (hasMultipleModels) {
                            setExpandedConfigId(isExpanded ? null : config.id);
                            return;
                          }
                          void handleSelect(config, 0);
                        }}
                        type="button"
                      >
                        <span className="agent-model-selector-config-name">{config.name}</span>
                        {hasMultipleModels ? (
                          <span className="agent-model-selector-config-tail">
                            <span className="agent-model-selector-config-count">
                              {config.models.length} models
                            </span>
                            {isExpanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                          </span>
                        ) : (
                          <span className="agent-model-selector-config-model">
                            {configModelSummary(config)}
                          </span>
                        )}
                      </button>

                      {hasMultipleModels && isExpanded ? (
                        <div className="agent-model-selector-model-list">
                          {config.models.map((item, index) => {
                            const isModelSelected =
                              config.selected && config.selected_model_index === index;
                            return (
                              <button
                                className={joinClasses(
                                  'agent-model-selector-model-row',
                                  isModelSelected && 'is-selected'
                                )}
                                key={`${config.id}-${item}-${index}`}
                                onClick={() => {
                                  void handleSelect(config, index);
                                }}
                                type="button"
                              >
                                {item}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              : null}

            {selector?.locked_by_character_card ? (
              <div className="agent-model-selector-lock-hint">
                The current character card has a fixed model: {selector.locked_character_card_name || 'Current character'}
              </div>
            ) : null}

            {localMessage ? <div className="agent-model-selector-local-message">{localMessage}</div> : null}
          </div>
        ) : null}
      </div>

      <CharacterCardModelBindingSwitchConfirmDialog
        onConfirm={() => {
          if (!pendingSelection) {
            return;
          }
          void runSelection(
            pendingSelection.configId,
            pendingSelection.modelIndex,
            true
          );
        }}
        onDismiss={() => setPendingSelection(null)}
        open={pendingSelection !== null}
      />
    </>
  );
}

function AgentMemorySelectorItem({
  expanded,
  memorySelector,
  onExpandedChange,
  onInfoClick,
  onSelectProfile
}: {
  expanded: boolean;
  memorySelector: WebMemorySelectorState | null;
  onExpandedChange: (value: boolean) => void;
  onInfoClick: () => void;
  onSelectProfile: (profileId: string) => Promise<void>;
}) {
  const currentProfileName =
    memorySelector?.profiles.find((profile) => profile.id === memorySelector.current_profile_id)?.name ??
    'None selected';

  return (
    <>
      <AgentSettingsRow onClick={() => onExpandedChange(!expanded)}>
        <span className="agent-settings-icon">
          <DataObjectIcon size={16} />
        </span>
        <AgentInfoButton onClick={onInfoClick} />
        <AgentInfoSpacer />
        <span className="agent-settings-summary">
          <strong>Memory:</strong>
          <span className="agent-settings-summary-value">{currentProfileName}</span>
        </span>
        <span className="agent-settings-chevron">
          {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
        </span>
      </AgentSettingsRow>

      {expanded ? (
        <div className="agent-settings-option-panel">
          {(memorySelector?.profiles ?? []).map((profile) => {
            const isSelected = profile.id === memorySelector?.current_profile_id;
            return (
              <button
                className={joinClasses('agent-settings-option-row', isSelected && 'is-selected')}
                key={profile.id}
                onClick={() => {
                  void onSelectProfile(profile.id);
                  onExpandedChange(false);
                }}
                type="button"
              >
                <span className="agent-settings-option-label">{profile.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

function AgentThinkingSettingsItem({
  enabled,
  expanded,
  onExpandedChange,
  onInfoClick,
  onQualityChange,
  onQualityInfoClick,
  onToggle,
  onToggleInfoClick,
  qualityMapping,
  qualityOptionId
}: {
  enabled: boolean;
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
  onInfoClick: () => void;
  onQualityChange: (value: string) => void;
  onQualityInfoClick: () => void;
  onToggle: () => void;
  onToggleInfoClick: () => void;
  qualityMapping: WebThinkingQualityMapping | undefined;
  qualityOptionId: string;
}) {
  return (
    <>
      <AgentSettingsRow onClick={() => onExpandedChange(!expanded)}>
        <span className={joinClasses('agent-settings-icon', enabled && 'is-active')}>
          <TuneIcon size={16} />
        </span>
        <AgentInfoButton onClick={onInfoClick} />
        <AgentInfoSpacer />
        <span className="agent-settings-summary">
          <strong>Thinking:</strong>
          <span className="agent-settings-summary-value">{enabled ? 'Thinking mode' : 'Off'}</span>
        </span>
        <span className="agent-settings-chevron">
          {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
        </span>
      </AgentSettingsRow>

      {expanded ? (
        <div className="agent-settings-expand-panel">
          <AgentSimpleToggleSettingItem
            checked={enabled}
            icon={TuneIcon}
            onInfoClick={onToggleInfoClick}
            onToggle={onToggle}
            title="Thinking mode"
          />
          {enabled && qualityMapping?.mode === 'levels' ? (
            <AgentSettingsRow className="is-child">
              <span className="agent-settings-icon is-active">
                <TuneIcon size={16} />
              </span>
              <AgentInfoButton onClick={onQualityInfoClick} />
              <AgentInfoSpacer />
              <ThinkingQualitySlider
                label="Thinking level"
                mapping={qualityMapping}
                onChange={onQualityChange}
                value={qualityOptionId}
              />
            </AgentSettingsRow>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function AgentMaxContextSettingItem({
  checked,
  onInfoClick,
  onToggle
}: {
  checked: boolean;
  onInfoClick: () => void;
  onToggle: () => void;
}) {
  return (
    <AgentSettingsRow onClick={onToggle}>
      <span className={joinClasses('agent-settings-icon', checked && 'is-active')}>
        <LinkIcon size={16} />
      </span>
      <AgentInfoButton onClick={onInfoClick} />
      <AgentInfoSpacer />
      <span className="agent-settings-title">Max mode</span>
      <AgentSwitch checked={checked} />
    </AgentSettingsRow>
  );
}

function AgentDisableSettingsGroupItem({
  disableStreamOutput,
  disableUserPreferenceDescription,
  enableTools,
  expanded,
  onDisablePreferenceDescription,
  onDisablePreferenceDescriptionInfoClick,
  onDisableStreamOutput,
  onDisableStreamOutputInfoClick,
  onDisableToolsInfoClick,
  onExpandedChange,
  onGroupInfoClick,
  onToggleTools
}: {
  disableStreamOutput: boolean;
  disableUserPreferenceDescription: boolean;
  enableTools: boolean;
  expanded: boolean;
  onDisablePreferenceDescription: () => void;
  onDisablePreferenceDescriptionInfoClick: () => void;
  onDisableStreamOutput: () => void;
  onDisableStreamOutputInfoClick: () => void;
  onDisableToolsInfoClick: () => void;
  onExpandedChange: (value: boolean) => void;
  onGroupInfoClick: () => void;
  onToggleTools: () => void;
}) {
  const disabledCount = [disableStreamOutput, !enableTools, disableUserPreferenceDescription].filter(Boolean).length;

  return (
    <>
      <AgentSettingsRow onClick={() => onExpandedChange(!expanded)}>
        <span className="agent-settings-icon">
          <TuneIcon size={16} />
        </span>
        <AgentInfoButton onClick={onGroupInfoClick} />
        <AgentInfoSpacer />
        <span className="agent-settings-summary">
          <strong>Disable options:</strong>
          <span className="agent-settings-summary-value">{`${disabledCount}/3`}</span>
        </span>
        <span className="agent-settings-chevron">
          {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
        </span>
      </AgentSettingsRow>

      {expanded ? (
        <div className="agent-settings-expand-panel">
          <AgentSimpleToggleSettingItem
            checked={disableStreamOutput}
            icon={InfoIcon}
            onInfoClick={onDisableStreamOutputInfoClick}
            onToggle={onDisableStreamOutput}
            title="Disable streaming"
          />
          <AgentSimpleToggleSettingItem
            checked={!enableTools}
            icon={TuneIcon}
            onInfoClick={onDisableToolsInfoClick}
            onToggle={onToggleTools}
            title="Disable tools"
          />
          <AgentSimpleToggleSettingItem
            checked={disableUserPreferenceDescription}
            icon={PersonIcon}
            onInfoClick={onDisablePreferenceDescriptionInfoClick}
            onToggle={onDisablePreferenceDescription}
            title="Disable user preference description"
          />
        </div>
      ) : null}
    </>
  );
}

function AgentInfoPopup({
  content,
  onDismiss
}: {
  content: InfoContent;
  onDismiss: () => void;
}) {
  return (
    <div className="agent-settings-info-scrim" onClick={onDismiss} role="presentation">
      <div className="agent-settings-info-card" onClick={(event) => event.stopPropagation()} role="dialog">
        <h3>{content.title}</h3>
        <p>{content.description}</p>
      </div>
    </div>
  );
}

export function AgentChatInputSection({
  messageInput,
  onMessageInputChange,
  onSendMessage,
  onQueueMessage,
  onCancelMessage,
  onUploadFiles,
  pendingUploads,
  onRemovePendingUpload,
  isLoading,
  inputProcessingStage,
  showInputProcessingStatus,
  attachmentPanelOpen,
  onAttachmentPanelChange,
  pendingQueueMessages,
  isPendingQueueExpanded,
  onPendingQueueExpandedChange,
  onDeletePendingQueueMessage,
  onEditPendingQueueMessage,
  onSendPendingQueueMessage,
  modelSelector,
  modelSelectorLoading,
  onSelectModelConfig,
  memorySelector,
  onSelectMemoryProfile,
  onRunManualMemoryUpdate,
  inputSettings,
  onUpdateInputSettings
}: {
  messageInput: string;
  onMessageInputChange: (value: string) => void;
  onSendMessage: () => Promise<void>;
  onQueueMessage: () => void;
  onCancelMessage: () => void;
  onUploadFiles: (files: FileList | File[]) => Promise<void>;
  pendingUploads: WebUploadedAttachment[];
  onRemovePendingUpload: (attachmentId: string) => void;
  isLoading: boolean;
  inputProcessingStage: InputProcessingStage;
  showInputProcessingStatus: boolean;
  attachmentPanelOpen: boolean;
  onAttachmentPanelChange: (value: boolean) => void;
  pendingQueueMessages: PendingQueueMessageItem[];
  isPendingQueueExpanded: boolean;
  onPendingQueueExpandedChange: (value: boolean) => void;
  onDeletePendingQueueMessage: (id: number) => void;
  onEditPendingQueueMessage: (id: number) => void;
  onSendPendingQueueMessage: (id: number) => Promise<void>;
  modelSelector: WebModelSelectorState | null;
  modelSelectorLoading: boolean;
  onSelectModelConfig: (
    configId: string,
    modelIndex: number,
    confirmCharacterCardSwitch?: boolean
  ) => Promise<WebSelectModelResponse | null>;
  memorySelector: WebMemorySelectorState | null;
  onSelectMemoryProfile: (profileId: string) => Promise<void>;
  onRunManualMemoryUpdate: () => Promise<void>;
  contextPercent: number;
  contextCurrentValue: number;
  contextMaxValue: number;
  inputSettings: WebInputSettingsState | null;
  onUpdateInputSettings: (
    payload: Partial<{
      enable_thinking_mode: boolean;
      thinking_option_id: string;
      enable_memory_auto_update: boolean;
      enable_auto_read: boolean;
      enable_max_context_mode: boolean;
      enable_tools: boolean;
      disable_stream_output: boolean;
      disable_user_preference_description: boolean;
      permission_level: string;
    }>
  ) => Promise<void>;
  theme: WebThemeSnapshot | null;
}) {
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [showExtraSettings, setShowExtraSettings] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showThinkingDropdown, setShowThinkingDropdown] = useState(false);
  const [showMemoryDropdown, setShowMemoryDropdown] = useState(false);
  const [showDisableSettingsDropdown, setShowDisableSettingsDropdown] = useState(false);
  const [infoPopupContent, setInfoPopupContent] = useState<InfoContent | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSendMessage = messageInput.trim().length > 0 || pendingUploads.length > 0;
  const showQueueAction = isLoading && messageInput.trim().length > 0;
  const showCancelAction = isLoading && !showQueueAction;
  const showProcessingStatus = showInputProcessingStatus && inputProcessingStage !== 'idle';
  const processingProgress =
    inputProcessingStage === 'streaming' ? 0.82 : inputProcessingStage === 'uploading' ? 0.56 : 0.4;
  const modelLabel = (() => {
    const currentModelName = modelSelector?.current_model_name?.trim();
    if (!currentModelName) {
      return 'Model configuration';
    }
    return currentModelName.length > 26 ? `${currentModelName.slice(0, 26)}...` : currentModelName;
  })();
  const progressRadius = 18;
  const circumference = 2 * Math.PI * progressRadius;
  const dashOffset = circumference - processingProgress * circumference;
  const thinkingMapping = modelSelector?.thinking_quality_mapping;
  const thinkingEnabled = (inputSettings?.enable_thinking_mode ?? false) || (thinkingMapping?.reasoning_required ?? false);
  const thinkingQuality = inputSettings
    ? {
        optionId: inputSettings.thinking_option_id,
        mapping: thinkingMapping
      }
    : null;
  useEffect(() => {
    const mapping = thinkingQuality?.mapping;
    if (mapping && mapping.options.length > 0 && !mapping.options.some((option) => option.id === thinkingQuality.optionId)) {
      void onUpdateInputSettings({ thinking_option_id: mapping.options[0].id });
    }
  }, [onUpdateInputSettings, thinkingQuality?.mapping, thinkingQuality?.optionId]);
  const enableMaxContextMode = inputSettings?.enable_max_context_mode ?? false;
  const enableMemoryAutoUpdate = inputSettings?.enable_memory_auto_update ?? false;
  const enableAutoRead = inputSettings?.enable_auto_read ?? false;
  const enableTools = inputSettings?.enable_tools ?? false;
  const disableStreamOutput = inputSettings?.disable_stream_output ?? false;
  const disableUserPreferenceDescription =
    inputSettings?.disable_user_preference_description ?? false;
  const permissionLevel = inputSettings?.permission_level ?? 'ASK';

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [messageInput]);

  useEffect(() => {
    if (!showModelSelector) {
      setShowThinkingDropdown(false);
    }
  }, [showModelSelector]);

  useEffect(() => {
    if (!showExtraSettings) {
      setShowMemoryDropdown(false);
      setShowDisableSettingsDropdown(false);
    }
  }, [showExtraSettings]);

  function submitCurrentAction() {
    if (showCancelAction) {
      onCancelMessage();
      return;
    }
    if (showQueueAction) {
      onQueueMessage();
      return;
    }
    if (canSendMessage) {
      void onSendMessage();
    }
  }

  return (
    <div className="agent-chat-input-section">
      <PendingMessageQueuePanel
        expanded={isPendingQueueExpanded}
        onDeleteMessage={onDeletePendingQueueMessage}
        onEditMessage={onEditPendingQueueMessage}
        onExpandedChange={onPendingQueueExpandedChange}
        onSendMessage={(id) => {
          void onSendPendingQueueMessage(id);
        }}
        queuedMessages={pendingQueueMessages}
      />

      {showProcessingStatus ? (
        <div className="input-processing-status is-agent">
          <div className="input-processing-status-message">{processingLabel(inputProcessingStage)}</div>
        </div>
      ) : null}

      {pendingUploads.length ? (
        <div className="composer-attachment-strip is-agent">
          {pendingUploads.map((upload) => (
            <AttachmentChip
              attachment={uploadedAttachmentToMessageAttachment(upload)}
              key={upload.attachment_id}
              onRemove={onRemovePendingUpload}
              removable
            />
          ))}
        </div>
      ) : null}

      <div className="agent-input-card">
        <label className="agent-input-field">
          <textarea
            onChange={(event) => onMessageInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitCurrentAction();
              }
            }}
            placeholder="Ask a question..."
            ref={textareaRef}
            rows={1}
            value={messageInput}
          />
          <button className="agent-input-fullscreen" onClick={() => setFullscreenOpen(true)} type="button">
            <FullscreenIcon size={16} />
          </button>
        </label>

        <div className="agent-input-bottom">
          <div className="agent-model-slot">
            <button
              aria-expanded={showModelSelector}
              className={`agent-model-pill ${showModelSelector ? 'is-active' : ''}`}
              onClick={() => {
                onAttachmentPanelChange(false);
                setShowExtraSettings(false);
                setShowModelSelector(!showModelSelector);
              }}
              type="button"
            >
              <strong>{modelLabel || 'None selected'}</strong>
              {showModelSelector ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
            </button>
          </div>

          <button
            className={`agent-icon-button ${showExtraSettings ? 'is-active' : ''}`}
            onClick={() => {
              onAttachmentPanelChange(false);
              setShowModelSelector(false);
              setShowExtraSettings(!showExtraSettings);
            }}
            title="Settings"
            type="button"
          >
            <TuneIcon size={20} />
          </button>

          <button
            className={`agent-icon-button ${attachmentPanelOpen ? 'is-active' : ''}`}
            onClick={() => {
              setShowModelSelector(false);
              setShowExtraSettings(false);
              onAttachmentPanelChange(!attachmentPanelOpen);
            }}
            title="Attachments"
            type="button"
          >
            <PlusIcon size={24} />
          </button>

          <div className="agent-action-orb-shell">
            {showProcessingStatus ? (
              <svg className="agent-action-progress" viewBox="0 0 44 44">
                <circle className="agent-action-progress-track" cx="22" cy="22" r={progressRadius} />
                <circle
                  className="agent-action-progress-value"
                  cx="22"
                  cy="22"
                  r={progressRadius}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
            ) : null}
            <button
              className={[
                'agent-action-orb',
                showQueueAction ? 'is-queue' : '',
                showCancelAction ? 'is-danger' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={submitCurrentAction}
              type="button"
            >
              {showCancelAction ? (
                <StopIcon size={18} />
              ) : (
                <SendIcon size={18} />
              )}
            </button>
          </div>
        </div>
      </div>

      {showModelSelector ? (
        <InputOverlayPopup onDismiss={() => setShowModelSelector(false)} panelClassName="agent-popup-card">
          <div className="agent-popup-scroll">
            <div className="agent-popup-body">
              {thinkingQuality && thinkingQuality.mapping?.mode !== 'unsupported' ? (
                <AgentThinkingSettingsItem
                  enabled={thinkingEnabled}
                  expanded={showThinkingDropdown}
                  onExpandedChange={setShowThinkingDropdown}
                  onInfoClick={() => setInfoPopupContent(INFO_COPY.thinkingSettings)}
                  onQualityChange={(value) => {
                    void onUpdateInputSettings({ thinking_option_id: value });
                  }}
                  onQualityInfoClick={() => setInfoPopupContent(INFO_COPY.thinkingQuality)}
                  onToggle={() => {
                    if (!thinkingQuality?.mapping?.reasoning_required) {
                      void onUpdateInputSettings({ enable_thinking_mode: !thinkingEnabled });
                    }
                  }}
                  onToggleInfoClick={() => setInfoPopupContent(INFO_COPY.thinkingMode)}
                  qualityMapping={thinkingQuality.mapping}
                  qualityOptionId={thinkingQuality.optionId}
                />
              ) : null}

              <AgentMaxContextSettingItem
                checked={enableMaxContextMode}
                onInfoClick={() => setInfoPopupContent(INFO_COPY.maxMode)}
                onToggle={() => {
                  void onUpdateInputSettings({ enable_max_context_mode: !enableMaxContextMode });
                }}
              />

              <AgentModelSelectorItem
                allowCollapse={false}
                expanded
                loading={modelSelectorLoading}
                onExpandedChange={() => {}}
                onInfoClick={() =>
                  setInfoPopupContent({
                    title: 'Model configuration',
                    description: 'Choose an already configured model here, or tap Manage configurations below to create or edit models'
                  })
                }
                onSelectModel={onSelectModelConfig}
                selector={modelSelector}
              />
            </div>
          </div>
        </InputOverlayPopup>
      ) : null}

      {showExtraSettings ? (
        <InputOverlayPopup onDismiss={() => setShowExtraSettings(false)} panelClassName="agent-popup-card">
          <div className="agent-popup-scroll">
            <div className="agent-popup-body">
              <AgentMemorySelectorItem
                expanded={showMemoryDropdown}
                memorySelector={memorySelector}
                onExpandedChange={setShowMemoryDropdown}
                onInfoClick={() => setInfoPopupContent(INFO_COPY.memory)}
                onSelectProfile={onSelectMemoryProfile}
              />

              <AgentSimpleToggleSettingItem
                checked={enableMemoryAutoUpdate}
                icon={SaveIcon}
                onInfoClick={() => setInfoPopupContent(INFO_COPY.memoryAutoUpdate)}
                onToggle={() => {
                  void onUpdateInputSettings({ enable_memory_auto_update: !enableMemoryAutoUpdate });
                }}
                title="Auto-save memory"
              />

              <AgentActionSettingItem
                icon={SaveIcon}
                onClick={() => {
                  void onRunManualMemoryUpdate();
                  setShowExtraSettings(false);
                }}
                onInfoClick={() => setInfoPopupContent(INFO_COPY.manualMemoryUpdate)}
                title="Update memory now"
              />

              <AgentSimpleToggleSettingItem
                checked={enableAutoRead}
                icon={HistoryIcon}
                onInfoClick={() => setInfoPopupContent(INFO_COPY.autoRead)}
                onToggle={() => {
                  void onUpdateInputSettings({ enable_auto_read: !enableAutoRead });
                }}
                title="Auto read aloud"
              />

              <AgentSimpleToggleSettingItem
                checked={permissionLevel === 'ALLOW'}
                icon={LockIcon}
                onInfoClick={() => setInfoPopupContent(INFO_COPY.autoApprove)}
                onToggle={() => {
                  void onUpdateInputSettings({
                    permission_level: permissionLevel === 'ALLOW' ? 'ASK' : 'ALLOW'
                  });
                }}
                title="Auto approve"
              />

              <AgentDisableSettingsGroupItem
                disableStreamOutput={disableStreamOutput}
                disableUserPreferenceDescription={disableUserPreferenceDescription}
                enableTools={enableTools}
                expanded={showDisableSettingsDropdown}
                onDisablePreferenceDescription={() => {
                  void onUpdateInputSettings({
                    disable_user_preference_description: !disableUserPreferenceDescription
                  });
                }}
                onDisablePreferenceDescriptionInfoClick={() =>
                  setInfoPopupContent(INFO_COPY.disablePreferenceDescription)
                }
                onDisableStreamOutput={() => {
                  void onUpdateInputSettings({ disable_stream_output: !disableStreamOutput });
                }}
                onDisableStreamOutputInfoClick={() => setInfoPopupContent(INFO_COPY.disableStream)}
                onDisableToolsInfoClick={() => setInfoPopupContent(INFO_COPY.disableTools)}
                onExpandedChange={setShowDisableSettingsDropdown}
                onGroupInfoClick={() => setInfoPopupContent(INFO_COPY.disableGroup)}
                onToggleTools={() => {
                  void onUpdateInputSettings({ enable_tools: !enableTools });
                }}
              />
            </div>
          </div>
        </InputOverlayPopup>
      ) : null}

      <AttachmentSelector
        mode="agent"
        onDismiss={() => onAttachmentPanelChange(false)}
        onUploadFiles={(files) => {
          void onUploadFiles(files);
        }}
        visible={attachmentPanelOpen}
      />

      {fullscreenOpen ? (
        <FullscreenInputDialog
          onConfirm={() => setFullscreenOpen(false)}
          onDismiss={() => setFullscreenOpen(false)}
          onValueChange={onMessageInputChange}
          value={messageInput}
        />
      ) : null}

      {infoPopupContent ? (
        <AgentInfoPopup content={infoPopupContent} onDismiss={() => setInfoPopupContent(null)} />
      ) : null}
    </div>
  );
}
