import { useMemo, useSyncExternalStore } from 'react';
import { CheckCheck, Square } from 'lucide-react';
import { ViewerButton, ViewerInput } from './Controls';
import { registerViewerDomRef } from '@/app/viewer-dom';
import {
  activateViewerSprite,
  clearViewerImages,
  clearViewerSprites,
  getViewerPanelsSnapshot,
  selectAllViewerImages,
  selectAllViewerSprites,
  setViewerImageChecked,
  setViewerImageRegex,
  setViewerSpriteChecked,
  setViewerSpriteRegex,
  subscribeViewerPanels,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

interface SidePanelProps {
  id: string;
  titleKey: string;
  title: string;
  allId: string;
  noneId: string;
  inputId: string;
  listId: string;
  placeholderKey: string;
  titleKeyForInput: string;
  placeholder: string;
  inputTitle: string;
  kind: 'images' | 'sprites';
  domRefName: 'panelImages' | 'panelSprites';
  hidden?: boolean;
}

export function SidePanel({
  id,
  titleKey,
  title,
  allId,
  noneId,
  inputId,
  listId,
  placeholderKey,
  titleKeyForInput,
  placeholder,
  inputTitle,
  kind,
  domRefName,
  hidden = false,
}: SidePanelProps) {
  const { t } = useI18n();
  const { imageRegex, images, spriteRegex, sprites } = useSyncExternalStore(
    subscribeViewerPanels,
    getViewerPanelsSnapshot,
    getViewerPanelsSnapshot,
  );
  const regexValue = kind === 'images' ? imageRegex : spriteRegex;
  const regex = useMemo(() => {
    if (!regexValue.trim()) return null;
    try {
      return new RegExp(regexValue.trim(), 'i');
    } catch {
      return false;
    }
  }, [regexValue]);
  const regexInvalid = regex === false;
  const isHiddenByRegex = (filterName: string) => regex instanceof RegExp && !regex.test(filterName);
  const setRegex = kind === 'images' ? setViewerImageRegex : setViewerSpriteRegex;
  const selectAll = kind === 'images' ? selectAllViewerImages : selectAllViewerSprites;
  const clearAll = kind === 'images' ? clearViewerImages : clearViewerSprites;

  return (
    <aside id={id} ref={element => registerViewerDomRef(domRefName, element)} className={`filter-panel${hidden ? ' hidden' : ''}`}>
      <div className="panel-header">
        <span>{t(titleKey) || title}</span>
        <div className="panel-btns">
          <ViewerButton id={allId} title={t('btn.selectAll.title')} onClick={selectAll}>
            <CheckCheck aria-hidden="true" />
            <span>{t('btn.selectAll')}</span>
          </ViewerButton>
          <ViewerButton id={noneId} title={t('btn.selectNone.title')} onClick={clearAll}>
            <Square aria-hidden="true" />
            <span>{t('btn.selectNone')}</span>
          </ViewerButton>
        </div>
      </div>
      <div className="panel-filter-row">
        <ViewerInput
          id={inputId}
          type="text"
          value={regexValue}
          className={regexInvalid ? 'regex-error' : undefined}
          placeholder={t(placeholderKey) || placeholder}
          title={t(titleKeyForInput) || inputTitle}
          onChange={event => setRegex(event.currentTarget.value)}
        />
      </div>
      <ul id={listId} className="filter-list">
        {kind === 'images' && images.map(item => (
          <li key={item.index} data-filter-name={item.filterName} className={isHiddenByRegex(item.filterName) ? 'regex-hidden' : undefined}>
            {item.thumbSrc ? <img className="item-thumb" src={item.thumbSrc} alt="" /> : null}
            <input
              type="checkbox"
              className="filter-switch-input"
              checked={item.checked}
              onChange={event => setViewerImageChecked(item.index, event.currentTarget.checked)}
            />
            <span className="item-label" title={item.title}>{item.name}</span>
            {item.sizeText ? <span className="item-size">{item.sizeText}</span> : null}
          </li>
        ))}
        {kind === 'sprites' && sprites.map(item => (
          <li
            key={item.key}
            data-sprite-index={item.main ? 'main' : String(item.spriteIndex)}
            data-filter-name={item.filterName}
            className={[
              item.active ? 'active-sprite' : '',
              isHiddenByRegex(item.filterName) ? 'regex-hidden' : '',
            ].filter(Boolean).join(' ') || undefined}
          >
            {item.thumbSrc ? <img className="item-thumb" src={item.thumbSrc} alt="" /> : (item.main ? <span className="sprite-spacer" /> : null)}
            {item.checked === null ? null : (
              <input
                type="checkbox"
                className="filter-switch-input"
                checked={item.checked}
                onChange={event => {
                  if (item.spriteIndex !== null) {
                    setViewerSpriteChecked(item.spriteIndex, event.currentTarget.checked);
                  }
                }}
              />
            )}
            <span className="item-label">{item.name}</span>
            <span className="item-size">{item.frameText}</span>
            <button
              type="button"
              className="btn-activate"
              title={item.main ? t('sprite.activateMain.title') : t('sprite.activate.title')}
              onClick={(event) => {
                event.stopPropagation();
                if (item.spriteIndex !== null) activateViewerSprite(item.spriteIndex);
              }}
            >
              ▶
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
