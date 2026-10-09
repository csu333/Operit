import { useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DataObjectIcon,
  InfoIcon
} from '../../../../util/chatIcons';
import type {
  WebModelSelectorConfig,
  WebModelSelectorState,
  WebSelectModelResponse
} from '../../../../util/chatTypes';
import { CharacterCardModelBindingSwitchConfirmDialog } from './CharacterCardModelBindingSwitchConfirmDialog';

const AUTO_GLM_WARNING =
  'Do not use autoglm as the main chat model. The chat model and the UI controller model are separate; choose any other capable LLM. If in doubt, read the documentation on how model configuration works.';

type PendingSelection = {
  configId: string;
  modelIndex: number;
};

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

export function ModelSelectorPanel({
  selector,
  loading,
  expanded,
  onExpandedChange,
  onSelectModel,
  allowCollapse = true,
  onInfoClick,
  onManageModels,
  onSelectionCommitted
}: {
  selector: WebModelSelectorState | null;
  loading?: boolean;
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
  onSelectModel: (
    configId: string,
    modelIndex: number,
    confirmCharacterCardSwitch?: boolean
  ) => Promise<WebSelectModelResponse | null>;
  allowCollapse?: boolean;
  onInfoClick: () => void;
  onManageModels?: (() => void) | null;
  onSelectionCommitted?: (() => void) | null;
}) {
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const modelName = useMemo(() => currentModelName(selector), [selector]);

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
      onSelectionCommitted?.();
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
      <div className="model-selector-panel">
        <div className="model-selector-header">
          <span className="model-selector-header-icon">
            <DataObjectIcon size={16} />
          </span>
          <button
            className="model-selector-info-button"
            onClick={onInfoClick}
            type="button"
          >
            <InfoIcon size={16} />
          </button>
          <span aria-hidden="true" className="model-selector-info-spacer" />
          <button
            className={`model-selector-summary ${allowCollapse ? 'is-clickable' : ''}`}
            onClick={() => {
              if (allowCollapse) {
                onExpandedChange(!expanded);
              }
            }}
            type="button"
          >
            <span className="model-selector-summary-main">
              <span className="model-selector-summary-label">Model:</span>
              <span className="model-selector-summary-label-spacer" />
              <span className="model-selector-summary-value">{modelName}</span>
            </span>
            {allowCollapse ? (
              expanded ? <ChevronUpIcon size={20} /> : <ChevronDownIcon size={20} />
            ) : null}
          </button>
        </div>

        {expanded ? (
          <div className="model-selector-body">
            {loading ? <div className="model-selector-empty">Loading model configurations...</div> : null}

            {!loading && !selector?.configs.length ? (
              <div className="model-selector-empty">No models available</div>
            ) : null}

            {!loading
              ? selector?.configs.map((config) => {
                  const isSelected = config.selected;
                  const hasMultipleModels = config.models.length > 1;
                  const isExpanded = expandedConfigId === config.id;

                  return (
                    <div className="model-selector-config-block" key={config.id}>
                      <button
                        className={`model-selector-config-row ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => {
                          if (hasMultipleModels) {
                            setExpandedConfigId(isExpanded ? null : config.id);
                            return;
                          }
                          void handleSelect(config, 0);
                        }}
                        type="button"
                      >
                        <span className="model-selector-config-name">{config.name}</span>
                        {hasMultipleModels ? (
                          <span className="model-selector-config-tail">
                            <span className="model-selector-config-count">
                              {config.models.length} models
                            </span>
                            {isExpanded ? (
                              <ChevronUpIcon size={16} />
                            ) : (
                              <ChevronDownIcon size={16} />
                            )}
                          </span>
                        ) : (
                          <span className="model-selector-config-model">
                            {configModelSummary(config)}
                          </span>
                        )}
                      </button>

                      {hasMultipleModels && isExpanded ? (
                        <div className="model-selector-model-list">
                          {config.models.map((item, index) => {
                            const isModelSelected =
                              config.selected && config.selected_model_index === index;
                            return (
                              <button
                                className={`model-selector-model-row ${isModelSelected ? 'is-selected' : ''}`}
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

            {onManageModels ? (
              <button className="model-selector-manage-button" onClick={onManageModels} type="button">
                Manage configurations
              </button>
            ) : null}

            {selector?.locked_by_character_card ? (
              <div className="model-selector-lock-hint">
                The current character card has a fixed model: {selector.locked_character_card_name || 'Current character'}
              </div>
            ) : null}

            {localMessage ? <div className="model-selector-local-message">{localMessage}</div> : null}
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
