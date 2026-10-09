import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DataObjectIcon,
  HistoryIcon,
  InfoIcon,
  LinkIcon,
  LockIcon,
  PersonIcon,
  SaveIcon,
  TuneIcon
} from '../../../../util/chatIcons';
import type {
  WebInputSettingsState,
  WebModelSelectorConfig,
  WebMemorySelectorState,
  WebModelSelectorState,
  WebSelectModelResponse,
  WebThinkingQualityMapping
} from '../../../../util/chatTypes';
import { CharacterCardModelBindingSwitchConfirmDialog } from '../common/CharacterCardModelBindingSwitchConfirmDialog';
import { ThinkingQualitySlider } from '../common/ThinkingQualitySlider';

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
  manualConversationSummary: {
    title: 'Summarize chat now',
    description: 'Generate a summary of the current chat right now.'
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

function currentModelName(selector: WebModelSelectorState | null) {
  const value = selector?.current_model_name?.trim();
  return value ? value : 'None selected';
}

function configModelSummary(config: WebModelSelectorConfig) {
  if (config.models.length > 1) {
    return `${config.models.length} models`;
  }
  return config.model_name || 'None selected';
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function ClassicInfoButton({
  onClick
}: {
  onClick: () => void;
}) {
  return (
    <button
      className="classic-settings-info-button"
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

function ClassicInfoSpacer() {
  return <span aria-hidden="true" className="classic-settings-info-spacer" />;
}

function ClassicSettingsRow({
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
        className={joinClasses('classic-settings-popup-row', className)}
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

  return <div className={joinClasses('classic-settings-popup-row', className)}>{children}</div>;
}

function ClassicSettingItem({
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
    <ClassicSettingsRow onClick={onToggle}>
      <span className={joinClasses('classic-settings-popup-icon', checked && 'is-active')}>
        <Icon size={16} />
      </span>
      <ClassicInfoButton onClick={onInfoClick} />
      <ClassicInfoSpacer />
      <span className="classic-settings-popup-copy">
        <strong>{title}</strong>
      </span>
      <span className={joinClasses('classic-settings-switch', checked && 'is-checked')}>
        <span className="classic-settings-switch-thumb" />
      </span>
    </ClassicSettingsRow>
  );
}

function ClassicActionSettingItem({
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
    <ClassicSettingsRow className="classic-settings-action-row" onClick={onClick}>
      <span className="classic-settings-popup-icon">
        <Icon size={16} />
      </span>
      <ClassicInfoButton onClick={onInfoClick} />
      <ClassicInfoSpacer />
      <span className="classic-settings-action-title">{title}</span>
    </ClassicSettingsRow>
  );
}

function ClassicModelSelectorItem({
  expanded,
  loading,
  onExpandedChange,
  onInfoClick,
  onSelectModel,
  selector
}: {
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
  const modelName = currentModelName(selector);

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
      onExpandedChange(false);
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
      <div className="classic-model-selector">
        <ClassicSettingsRow onClick={() => onExpandedChange(!expanded)}>
          <span className="classic-settings-popup-icon">
            <DataObjectIcon size={16} />
          </span>
          <ClassicInfoButton onClick={onInfoClick} />
          <ClassicInfoSpacer />
          <span className="classic-settings-popup-summary-shell">
            <span className="classic-settings-popup-summary">
              <strong>Model:</strong>
              <span className="classic-settings-popup-summary-value">{modelName}</span>
            </span>
          </span>
          <span className="classic-settings-popup-chevron">
            {expanded ? <ChevronUpIcon size={20} /> : <ChevronDownIcon size={20} />}
          </span>
        </ClassicSettingsRow>

        {expanded ? (
          <div className="classic-model-selector-body">
            {loading ? <div className="classic-model-selector-empty">Loading model configurations...</div> : null}

            {!loading && !selector?.configs.length ? (
              <div className="classic-model-selector-empty">No models available</div>
            ) : null}

            {!loading
              ? selector?.configs.map((config) => {
                  const isSelected = config.selected;
                  const hasMultipleModels = config.models.length > 1;
                  const isExpanded = expandedConfigId === config.id;

                  return (
                    <div className="classic-model-selector-config-block" key={config.id}>
                      <button
                        className={joinClasses(
                          'classic-model-selector-config-row',
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
                        <span className="classic-model-selector-config-name">{config.name}</span>
                        {hasMultipleModels ? (
                          <span className="classic-model-selector-config-tail">
                            <span className="classic-model-selector-config-count">
                              {config.models.length} models
                            </span>
                            {isExpanded ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                          </span>
                        ) : (
                          <span className="classic-model-selector-config-model">
                            {configModelSummary(config)}
                          </span>
                        )}
                      </button>

                      {hasMultipleModels && isExpanded ? (
                        <div className="classic-model-selector-model-list">
                          {config.models.map((item, index) => {
                            const isModelSelected =
                              config.selected && config.selected_model_index === index;
                            return (
                              <button
                                className={joinClasses(
                                  'classic-model-selector-model-row',
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
              <div className="classic-model-selector-lock-hint">
                The current character card has a fixed model: {selector.locked_character_card_name || 'Current character'}
              </div>
            ) : null}

            {localMessage ? (
              <div className="classic-model-selector-local-message">{localMessage}</div>
            ) : null}
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

function ClassicMemorySelectorItem({
  expanded,
  memorySelector,
  onManageClick,
  onExpandedChange,
  onInfoClick,
  onSelectProfile
}: {
  expanded: boolean;
  memorySelector: WebMemorySelectorState | null;
  onManageClick?: (() => void) | null;
  onExpandedChange: (value: boolean) => void;
  onInfoClick: () => void;
  onSelectProfile: (profileId: string) => Promise<void>;
}) {
  const currentProfileName =
    memorySelector?.profiles.find((profile) => profile.id === memorySelector.current_profile_id)?.name ??
    'None selected';

  return (
    <>
      <ClassicSettingsRow onClick={() => onExpandedChange(!expanded)}>
        <span className="classic-settings-popup-icon">
          <PersonIcon size={16} />
        </span>
        <ClassicInfoButton onClick={onInfoClick} />
        <ClassicInfoSpacer />
        <span className="classic-settings-popup-summary-shell">
          <span className="classic-settings-popup-summary">
            <strong>Memory:</strong>
            <span className="classic-settings-popup-summary-value">{currentProfileName}</span>
          </span>
        </span>
        <span className="classic-settings-popup-chevron">
          {expanded ? <ChevronUpIcon size={20} /> : <ChevronDownIcon size={20} />}
        </span>
      </ClassicSettingsRow>

      {expanded ? (
        <div className="classic-settings-option-panel">
          {(memorySelector?.profiles ?? []).map((profile) => {
            const isSelected = profile.id === memorySelector?.current_profile_id;
            return (
              <button
                className={joinClasses('classic-settings-option-row', isSelected && 'is-selected')}
                key={profile.id}
                onClick={() => {
                  void onSelectProfile(profile.id);
                  onExpandedChange(false);
                }}
                type="button"
              >
                <span className="classic-settings-option-label">{profile.name}</span>
              </button>
            );
          })}
          {onManageClick ? (
            <button className="classic-settings-manage-button" onClick={onManageClick} type="button">
              Manage configurations
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ClassicThinkingSettingsItem({
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
      <ClassicSettingsRow onClick={() => onExpandedChange(!expanded)}>
        <span className={joinClasses('classic-settings-popup-icon', enabled && 'is-active')}>
          <TuneIcon size={16} />
        </span>
        <ClassicInfoButton onClick={onInfoClick} />
        <ClassicInfoSpacer />
        <span className="classic-settings-popup-summary">
          <strong>Thinking:</strong>
          <span className="classic-settings-popup-summary-value">{enabled ? 'Thinking mode' : 'Off'}</span>
        </span>
        <span className="classic-settings-popup-chevron">
          {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
        </span>
      </ClassicSettingsRow>

      {expanded ? (
        <div className="classic-settings-expand-panel">
          <ClassicSettingItem
            checked={enabled}
            icon={TuneIcon}
            onInfoClick={onToggleInfoClick}
            onToggle={onToggle}
            title="Thinking mode"
          />
          {enabled && qualityMapping?.mode === 'levels' ? (
            <ClassicSettingsRow className="is-child">
              <span className="classic-settings-popup-icon is-active">
                <TuneIcon size={16} />
              </span>
              <ClassicInfoButton onClick={onQualityInfoClick} />
              <ClassicInfoSpacer />
              <ThinkingQualitySlider
                label="Thinking level"
                mapping={qualityMapping}
                onChange={onQualityChange}
                value={qualityOptionId}
              />
            </ClassicSettingsRow>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ClassicDisableSettingsGroup({
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
      <ClassicSettingsRow onClick={() => onExpandedChange(!expanded)}>
        <span className="classic-settings-popup-icon">
          <TuneIcon size={16} />
        </span>
        <ClassicInfoButton onClick={onGroupInfoClick} />
        <ClassicInfoSpacer />
        <span className="classic-settings-popup-summary">
          <strong>Disable options:</strong>
          <span className="classic-settings-popup-summary-value">{`${disabledCount}/3`}</span>
        </span>
        <span className="classic-settings-popup-chevron">
          {expanded ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
        </span>
      </ClassicSettingsRow>

      {expanded ? (
        <div className="classic-settings-expand-panel">
          <ClassicSettingItem
            checked={disableStreamOutput}
            icon={InfoIcon}
            onInfoClick={onDisableStreamOutputInfoClick}
            onToggle={onDisableStreamOutput}
            title="Disable streaming"
          />
          <ClassicSettingItem
            checked={!enableTools}
            icon={TuneIcon}
            onInfoClick={onDisableToolsInfoClick}
            onToggle={onToggleTools}
            title="Disable tools"
          />
          <ClassicSettingItem
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

function ClassicInfoPopup({
  content,
  onDismiss
}: {
  content: InfoContent;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="classic-settings-info-dismiss-layer" onClick={onDismiss} role="presentation" />
      <div className="classic-settings-info-shell" role="presentation">
        <div
          className="classic-settings-info-card"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <h3>{content.title}</h3>
          <p>{content.description}</p>
        </div>
      </div>
    </>
  );
}

export function ClassicChatSettingsBar({
  inputSettings,
  memorySelector,
  modelSelector,
  modelSelectorLoading,
  onRunManualConversationSummary,
  onRunManualMemoryUpdate,
  onSelectModelConfig,
  onSelectMemoryProfile,
  onToggleSettings,
  onUpdateInputSettings,
  settingsOpen
}: {
  contextPercent: number;
  contextCurrentValue: number;
  contextMaxValue: number;
  inputSettings: WebInputSettingsState | null;
  memorySelector: WebMemorySelectorState | null;
  modelSelector: WebModelSelectorState | null;
  modelSelectorLoading: boolean;
  onSelectModelConfig: (
    configId: string,
    modelIndex: number,
    confirmCharacterCardSwitch?: boolean
  ) => Promise<WebSelectModelResponse | null>;
  onSelectMemoryProfile: (profileId: string) => Promise<void>;
  onRunManualConversationSummary: () => Promise<void>;
  onRunManualMemoryUpdate: () => Promise<void>;
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
  onToggleSettings: () => void;
  settingsOpen: boolean;
}) {
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showMemoryDropdown, setShowMemoryDropdown] = useState(false);
  const [showThinkingDropdown, setShowThinkingDropdown] = useState(false);
  const [showDisableSettingsDropdown, setShowDisableSettingsDropdown] = useState(false);
  const [infoPopupContent, setInfoPopupContent] = useState<InfoContent | null>(null);
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

  function openInfo(content: InfoContent) {
    setInfoPopupContent(content);
    if (settingsOpen) {
      onToggleSettings();
    }
  }

  useEffect(() => {
    if (!settingsOpen) {
      setShowModelDropdown(false);
      setShowMemoryDropdown(false);
      setShowThinkingDropdown(false);
      setShowDisableSettingsDropdown(false);
    }
  }, [settingsOpen]);

  return (
    <div className="classic-chat-settings-bar">
      <button
        aria-expanded={settingsOpen}
        className={`classic-settings-anchor ${settingsOpen ? 'is-active' : ''}`}
        onClick={onToggleSettings}
        type="button"
      >
        <TuneIcon size={22} />
      </button>

      {settingsOpen ? (
        <>
          <div
            className="classic-settings-dismiss-layer"
            onClick={() => {
              if (settingsOpen) {
                onToggleSettings();
              }
            }}
            role="presentation"
          />
          <div
            className="classic-settings-popup-shell"
            role="presentation"
          >
            <div
              className="classic-settings-popup"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
            >
              <div className="classic-settings-popup-scroll">
                <ClassicModelSelectorItem
                  expanded={showModelDropdown}
                  loading={modelSelectorLoading}
                  onExpandedChange={setShowModelDropdown}
                  onInfoClick={() =>
                    openInfo({
                      title: 'Model configuration',
                      description: 'Choose an already configured model here, or tap Manage configurations below to create or edit models'
                    })
                  }
                  onSelectModel={onSelectModelConfig}
                  selector={modelSelector}
                />

                <ClassicMemorySelectorItem
                  expanded={showMemoryDropdown}
                  memorySelector={memorySelector}
                  onExpandedChange={setShowMemoryDropdown}
                  onInfoClick={() => openInfo(INFO_COPY.memory)}
                  onSelectProfile={onSelectMemoryProfile}
                />

                {thinkingQuality && thinkingQuality.mapping?.mode !== 'unsupported' ? (
                  <ClassicThinkingSettingsItem
                    enabled={thinkingEnabled}
                    expanded={showThinkingDropdown}
                    onExpandedChange={setShowThinkingDropdown}
                    onInfoClick={() => openInfo(INFO_COPY.thinkingSettings)}
                    onQualityChange={(value) => {
                      void onUpdateInputSettings({ thinking_option_id: value });
                    }}
                    onQualityInfoClick={() => openInfo(INFO_COPY.thinkingQuality)}
                    onToggle={() => {
                      if (!thinkingQuality?.mapping?.reasoning_required) {
                        void onUpdateInputSettings({ enable_thinking_mode: !thinkingEnabled });
                      }
                    }}
                    onToggleInfoClick={() => openInfo(INFO_COPY.thinkingMode)}
                    qualityMapping={thinkingQuality.mapping}
                    qualityOptionId={thinkingQuality.optionId}
                  />
                ) : null}

                <ClassicDisableSettingsGroup
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
                    openInfo(INFO_COPY.disablePreferenceDescription)
                  }
                  onDisableStreamOutput={() => {
                    void onUpdateInputSettings({ disable_stream_output: !disableStreamOutput });
                  }}
                  onDisableStreamOutputInfoClick={() => openInfo(INFO_COPY.disableStream)}
                  onDisableToolsInfoClick={() => openInfo(INFO_COPY.disableTools)}
                  onExpandedChange={setShowDisableSettingsDropdown}
                  onGroupInfoClick={() => openInfo(INFO_COPY.disableGroup)}
                  onToggleTools={() => {
                    void onUpdateInputSettings({ enable_tools: !enableTools });
                  }}
                />

                <ClassicSettingItem
                  checked={enableMaxContextMode}
                  icon={LinkIcon}
                  onInfoClick={() => openInfo(INFO_COPY.maxMode)}
                  onToggle={() => {
                    void onUpdateInputSettings({ enable_max_context_mode: !enableMaxContextMode });
                  }}
                  title="Max mode"
                />

                <div className="classic-settings-divider" />

                <ClassicSettingItem
                  checked={enableMemoryAutoUpdate}
                  icon={SaveIcon}
                  onInfoClick={() => openInfo(INFO_COPY.memoryAutoUpdate)}
                  onToggle={() => {
                    void onUpdateInputSettings({ enable_memory_auto_update: !enableMemoryAutoUpdate });
                  }}
                  title="Auto-save memory"
                />

                <ClassicActionSettingItem
                  icon={SaveIcon}
                  onClick={() => {
                    void onRunManualMemoryUpdate();
                    onToggleSettings();
                  }}
                  onInfoClick={() => openInfo(INFO_COPY.manualMemoryUpdate)}
                  title="Update memory now"
                />

                <ClassicActionSettingItem
                  icon={HistoryIcon}
                  onClick={() => {
                    void onRunManualConversationSummary();
                    onToggleSettings();
                  }}
                  onInfoClick={() => openInfo(INFO_COPY.manualConversationSummary)}
                  title="Summarize chat now"
                />

                <div className="classic-settings-divider" />

                <ClassicSettingItem
                  checked={enableAutoRead}
                  icon={HistoryIcon}
                  onInfoClick={() => openInfo(INFO_COPY.autoRead)}
                  onToggle={() => {
                    void onUpdateInputSettings({ enable_auto_read: !enableAutoRead });
                  }}
                  title="Auto read aloud"
                />

                <div className="classic-settings-divider" />

                <ClassicSettingItem
                  checked={permissionLevel === 'ALLOW'}
                  icon={LockIcon}
                  onInfoClick={() => openInfo(INFO_COPY.autoApprove)}
                  onToggle={() => {
                    void onUpdateInputSettings({
                      permission_level: permissionLevel === 'ALLOW' ? 'ASK' : 'ALLOW'
                    });
                  }}
                  title="Auto approve"
                />
              </div>
            </div>
          </div>
        </>
      ) : null}

      {infoPopupContent ? (
        <ClassicInfoPopup content={infoPopupContent} onDismiss={() => setInfoPopupContent(null)} />
      ) : null}
    </div>
  );
}
