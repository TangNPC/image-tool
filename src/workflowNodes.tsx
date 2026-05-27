"use client"

import {
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  BaseEdge,
  Handle,
  Position,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Palette,
  Play,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import type {
  LocalImageRecord,
  PromptOptimizationPreset,
  ReferenceImage,
  StyleOption,
} from './types'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Textarea } from './components/ui/textarea'

type GenerationMode = 'text' | 'image'
export const PROMPT_REFERENCE_HANDLE_IDS = Array.from({ length: 8 }, (_, index) =>
  `reference-${index + 1}`
)

type BaseNodeData = {
  onDeleteNode: (id: string) => void
} & Record<string, unknown>

export type AssetNodeData = {
  referenceImages: ReferenceImage[]
  addReferenceFiles: (files: FileList | File[]) => void
  removeReferenceImage: (id: string) => void
  updateReferenceImageTitle: (id: string, title: string) => void
  isReferenceTitleDuplicate: (id: string) => boolean
} & BaseNodeData

export type PromptNodeData = {
  prompt: string
  setPrompt: Dispatch<SetStateAction<string>>
  referenceImages: ReferenceImage[]
  referencePorts: Array<{ id: string; title: string }>
  optimizationPreset: PromptOptimizationPreset
  optimizationPresets: Array<{ value: PromptOptimizationPreset; label: string }>
  setOptimizationPreset: (preset: PromptOptimizationPreset) => void
  generationMode: GenerationMode
  isOptimizingPrompt: boolean
  canOptimizePrompt: boolean
  onOptimizePrompt: () => void
} & BaseNodeData

export type StyleNodeData = {
  styles: StyleOption[]
  categories: Array<{ name: string; count: number }>
  selectedStyleId: string
  setSelectedStyleId: (id: string) => void
  isLoadingStyles: boolean
} & BaseNodeData

export type GenerateNodeData = {
  model: string
  sortedModels: Array<{ id: string }>
  setModel: Dispatch<SetStateAction<string>>
  size: string
  sizes: string[]
  setSize: (value: string) => void
  quality: string
  qualities: string[]
  setQuality: Dispatch<SetStateAction<string>>
  count: number
  counts: number[]
  setCount: Dispatch<SetStateAction<number>>
  responseFormat: 'url' | 'b64_json'
  setResponseFormat: Dispatch<SetStateAction<'url' | 'b64_json'>>
  inputFidelity: 'low' | 'high'
  inputFidelities: readonly ('low' | 'high')[]
  setInputFidelity: Dispatch<SetStateAction<'low' | 'high'>>
  generationMode: GenerationMode
  isGenerating: boolean
  canGenerate: boolean
  onGenerate: () => void
  image: LocalImageRecord | null
  outputTitle: string
  updateOutputTitle: (title: string) => void
  isOutputTitleDuplicate: boolean
  onPreview: (image: LocalImageRecord) => void
  onDownload: (image: LocalImageRecord) => void
} & BaseNodeData

export type OutputNodeData = {
  image: LocalImageRecord | null
  isGenerating: boolean
  onPreview: (image: LocalImageRecord) => void
  onDownload: (image: LocalImageRecord) => void
} & BaseNodeData

export type BlueprintEdgeData = {
  label: string
} & Record<string, unknown>

type AssetFlowNode = Node<AssetNodeData, 'asset'>
type PromptFlowNode = Node<PromptNodeData, 'prompt'>
type StyleFlowNode = Node<StyleNodeData, 'style'>
type GenerateFlowNode = Node<GenerateNodeData, 'generate'>
type OutputFlowNode = Node<OutputNodeData, 'output'>
type BlueprintFlowEdge = Edge<BlueprintEdgeData, 'blueprint'>

type MentionState = {
  query: string
  start: number
  end: number
} | null

function normalizeMentionTitle(value: string) {
  return value.trim().replace(/^@+/, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getMentionState(value: string, caret: number): MentionState {
  const beforeCaret = value.slice(0, caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) return null

  const query = beforeCaret.slice(atIndex + 1)
  if (/[\s，。,.!！?？;；:：、()[\]{}<>《》"'“”‘’]/.test(query)) return null

  return { query, start: atIndex, end: caret }
}

type PromptMentionSummary = {
  title: string
  isKnown: boolean
}

type PromptHighlightSegment = {
  text: string
  kind: 'text' | 'known-mention' | 'missing-mention'
}

type PromptMentionRange = {
  start: number
  end: number
}

function getPromptMentionSummary(prompt: string, knownTitles: Set<string>) {
  const orderedTitles = [...knownTitles].sort((a, b) => b.length - a.length)
  if (orderedTitles.length > 0) {
    const mentions: PromptMentionSummary[] = []
    const pattern = new RegExp(`@(${orderedTitles.map(escapeRegExp).join('|')})`, 'g')
    let match: RegExpExecArray | null

    while ((match = pattern.exec(prompt)) !== null) {
      const title = normalizeMentionTitle(match[1] || '')
      if (!title || mentions.some((item) => item.title === title)) continue
      mentions.push({ title, isKnown: knownTitles.has(title) })
    }

    if (mentions.length > 0) return mentions
  }

  const mentions: PromptMentionSummary[] = []
  const pattern = /@([^\s@，。,.!！?？;；:：、()[\]{}<>《》"'“”‘’]+(?:\s+\d+)?)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(prompt)) !== null) {
    const rawTitle = match[1] || ''
    const title = normalizeMentionTitle(rawTitle)
    if (!title || mentions.some((item) => item.title === title)) continue
    mentions.push({ title, isKnown: knownTitles.has(title) })
  }

  return mentions
}

function getPromptHighlightSegments(
  prompt: string,
  knownTitles: Set<string>
): PromptHighlightSegment[] {
  const orderedTitles = [...knownTitles].sort((a, b) => b.length - a.length)
  const segments: PromptHighlightSegment[] = []
  let cursor = 0

  while (cursor < prompt.length) {
    const atIndex = prompt.indexOf('@', cursor)
    if (atIndex < 0) {
      segments.push({ text: prompt.slice(cursor), kind: 'text' })
      break
    }

    if (atIndex > cursor) {
      segments.push({ text: prompt.slice(cursor, atIndex), kind: 'text' })
    }

    const knownTitle = orderedTitles.find((title) => prompt.startsWith(`@${title}`, atIndex))
    if (knownTitle) {
      segments.push({ text: `@${knownTitle}`, kind: 'known-mention' })
      cursor = atIndex + knownTitle.length + 1
      continue
    }

    const unknownMatch = prompt
      .slice(atIndex)
      .match(/^@([^\s@，。,.!！?？;；:：、()[\]{}<>《》"'“”‘’]+(?:\s+\d+)?)/)
    if (unknownMatch) {
      segments.push({ text: unknownMatch[0], kind: 'missing-mention' })
      cursor = atIndex + unknownMatch[0].length
      continue
    }

    segments.push({ text: '@', kind: 'text' })
    cursor = atIndex + 1
  }

  return segments.length > 0 ? segments : [{ text: '', kind: 'text' }]
}

function getPromptMentionRanges(prompt: string, knownTitles: Set<string>): PromptMentionRange[] {
  const orderedTitles = [...knownTitles].sort((a, b) => b.length - a.length)
  const ranges: PromptMentionRange[] = []
  let cursor = 0

  while (cursor < prompt.length) {
    const atIndex = prompt.indexOf('@', cursor)
    if (atIndex < 0) break

    const knownTitle = orderedTitles.find((title) => prompt.startsWith(`@${title}`, atIndex))
    if (knownTitle) {
      ranges.push({ start: atIndex, end: atIndex + knownTitle.length + 1 })
      cursor = atIndex + knownTitle.length + 1
      continue
    }

    const unknownMatch = prompt
      .slice(atIndex)
      .match(/^@([^\s@，。,.!！?？;；:：、()[\]{}<>《》"'“”‘’]+(?:\s+\d+)?)/)
    if (unknownMatch) {
      ranges.push({ start: atIndex, end: atIndex + unknownMatch[0].length })
      cursor = atIndex + unknownMatch[0].length
      continue
    }

    cursor = atIndex + 1
  }

  return ranges
}

function getMentionRangeForDeletion(
  value: string,
  caret: number,
  direction: 'backward' | 'forward',
  knownTitles: Set<string>
) {
  const ranges = getPromptMentionRanges(value, knownTitles)
  if (direction === 'backward') {
    return ranges.find((range) => caret > range.start && caret <= range.end) || null
  }

  return ranges.find((range) => caret >= range.start && caret < range.end) || null
}

function NodeShell({
  id,
  accent,
  title,
  subtitle,
  titleAction,
  onDelete,
  children,
}: {
  id: string
  accent: 'blue' | 'violet' | 'pink' | 'green'
  title: string
  subtitle: string
  titleAction?: ReactNode
  onDelete: (id: string) => void
  children: ReactNode
}) {
  return (
    <section className={`flow-node flow-node-${accent}`}>
      <div className='node-title'>
        <span>{title}</span>
        <div>
          {titleAction}
          <small>{subtitle}</small>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='node-delete nodrag'
            onClick={(event) => {
              event.stopPropagation()
              onDelete(id)
            }}
            aria-label={`删除 ${title}`}
          >
            <X size={14} />
          </Button>
        </div>
      </div>
      {children}
    </section>
  )
}

function PortRow({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  function proxyPointerToHandle(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    if ((event.target as Element | null)?.closest('.react-flow__handle')) return

    const handle = event.currentTarget.querySelector<HTMLElement>('.react-flow__handle')
    if (!handle) return

    event.preventDefault()
    event.stopPropagation()
    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: event.button,
        buttons: event.buttons || 1,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      })
    )
  }

  return (
    <div className={`node-port-row ${className || ''}`} onMouseDown={proxyPointerToHandle}>
      {children}
    </div>
  )
}

export const AssetNode = memo(function AssetNode({ id, data }: NodeProps<AssetFlowNode>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lastFilePickerOpenAtRef = useRef(0)
  const referenceImage = data.referenceImages[0] || null
  const isReferenceTitleDuplicate = referenceImage
    ? data.isReferenceTitleDuplicate(referenceImage.id)
    : false

  function openReferenceFilePicker() {
    const now = Date.now()
    if (now - lastFilePickerOpenAtRef.current < 800) return

    lastFilePickerOpenAtRef.current = now
    fileInputRef.current?.click()
  }

  return (
    <NodeShell
      id={id}
      accent='blue'
      title='参考图片'
      subtitle='Reference'
      onDelete={data.onDeleteNode}
    >
      {referenceImage ? (
        <label
          className={`image-title-field image-title-field-reference nodrag ${isReferenceTitleDuplicate ? 'title-conflict' : ''}`}
          title={isReferenceTitleDuplicate ? '画布内图片名称重复' : '参考图名称'}
        >
          <span>@</span>
          <Input
            value={referenceImage.title ?? referenceImage.name}
            onChange={(event) =>
              data.updateReferenceImageTitle(referenceImage.id, event.target.value)
            }
            aria-invalid={isReferenceTitleDuplicate}
            placeholder='参考图标题'
            spellCheck={false}
          />
        </label>
      ) : null}
      <div className='node-port-grid asset-port-grid'>
        <PortRow className='node-port-row-source'>
          <span>参考图输出</span>
          <Handle type='source' position={Position.Right} id='reference' />
        </PortRow>
      </div>
      <div
        className={`asset-drop nodrag ${data.referenceImages.length > 0 ? 'asset-drop-filled' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          data.addReferenceFiles(event.dataTransfer.files)
        }}
      >
        {data.referenceImages.length === 0 ? (
          <>
            <ImageIcon size={34} />
            <strong>拖入图片 / 选择参考图</strong>
            <span>添加后作为生成参考输入</span>
          </>
        ) : (
          <div className={`asset-preview-grid asset-preview-count-${data.referenceImages.length}`}>
            {data.referenceImages.map((image) => (
              <article key={image.id} onDragStart={(event) => event.preventDefault()}>
                <img
                  src={image.dataUrl || ''}
                  alt={image.name}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='node-icon-button'
                  onClick={() => data.removeReferenceImage(image.id)}
                  aria-label={`移除 ${image.name}`}
                >
                  <X size={14} />
                </Button>
              </article>
            ))}
          </div>
        )}
        <Button
          type='button'
          variant='secondary'
          className='node-file-button nodrag'
          onClick={openReferenceFilePicker}
          onDoubleClick={(event) => event.preventDefault()}
        >
          <Upload size={15} />
          选择图片
        </Button>
        <Input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          style={{ display: 'none' }}
          onChange={(event) => {
            if (event.target.files) {
              data.addReferenceFiles(event.target.files)
            }
            event.currentTarget.value = ''
          }}
        />
      </div>
    </NodeShell>
  )
}, (prevProps, nextProps) => prevProps.id === nextProps.id && prevProps.data === nextProps.data)

export function PromptNode({ id, data }: NodeProps<PromptFlowNode>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionState, setMentionState] = useState<MentionState>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [promptScrollTop, setPromptScrollTop] = useState(0)
  const referenceTitles = useMemo(
    () =>
      data.referencePorts
        .map((port) => normalizeMentionTitle(port.title))
        .filter(Boolean),
    [data.referencePorts]
  )
  const knownReferenceTitles = useMemo(() => new Set(referenceTitles), [referenceTitles])
  const mentionSuggestions = useMemo(() => {
    if (!mentionState) return []
    const query = mentionState.query.toLowerCase()
    return referenceTitles
      .filter((title) => title.toLowerCase().includes(query))
      .slice(0, 8)
  }, [mentionState, referenceTitles])
  const mentionSummary = useMemo(
    () => getPromptMentionSummary(data.prompt, knownReferenceTitles),
    [data.prompt, knownReferenceTitles]
  )
  const highlightSegments = useMemo(
    () => getPromptHighlightSegments(data.prompt, knownReferenceTitles),
    [data.prompt, knownReferenceTitles]
  )
  const hasPromptMentions = highlightSegments.some((segment) => segment.kind !== 'text')

  function syncMentionState(textarea: HTMLTextAreaElement) {
    const nextState = getMentionState(textarea.value, textarea.selectionStart)
    setMentionState(nextState)
    setActiveMentionIndex(0)
  }

  function insertMention(title: string) {
    const textarea = textareaRef.current
    if (!textarea || !mentionState) return

    const before = data.prompt.slice(0, mentionState.start)
    const after = data.prompt.slice(mentionState.end)
    const inserted = `@${title} `
    const nextPrompt = `${before}${inserted}${after}`
    const nextCaret = before.length + inserted.length

    data.setPrompt(nextPrompt)
    setMentionState(null)
    window.setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
    }, 0)
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const direction = event.key === 'Backspace' ? 'backward' : 'forward'
      const mentionRange = getMentionRangeForDeletion(
        event.currentTarget.value,
        event.currentTarget.selectionStart,
        direction,
        knownReferenceTitles
      )

      if (mentionRange) {
        event.preventDefault()
        const nextPrompt =
          data.prompt.slice(0, mentionRange.start) + data.prompt.slice(mentionRange.end)
        data.setPrompt(nextPrompt)
        setMentionState(null)
        window.setTimeout(() => {
          const nextCaret = mentionRange.start
          textareaRef.current?.focus()
          textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
        }, 0)
        return
      }
    }

    if (!mentionState || mentionSuggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveMentionIndex((current) => (current + 1) % mentionSuggestions.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveMentionIndex(
        (current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length
      )
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      insertMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0])
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setMentionState(null)
    }
  }

  return (
    <NodeShell
      id={id}
      accent='violet'
      title='文字描述'
      subtitle='Prompt'
      titleAction={
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='node-title-action nodrag'
          onClick={(event) => {
            event.stopPropagation()
            data.onOptimizePrompt()
          }}
          disabled={data.isOptimizingPrompt || !data.prompt.trim()}
          aria-label='优化提示词'
          title='优化提示词'
        >
          {data.isOptimizingPrompt ? (
            <Loader2 className='spin' size={14} />
          ) : (
            <WandSparkles size={14} />
          )}
        </Button>
      }
      onDelete={data.onDeleteNode}
    >
      <div className='node-port-grid prompt-port-grid'>
        <div className='prompt-reference-port-list'>
          <PortRow className='node-port-row-target'>
            <Handle type='target' position={Position.Left} id='style' />
            <span>风格输入</span>
          </PortRow>
          {PROMPT_REFERENCE_HANDLE_IDS.map((handleId, index) => (
            <PortRow key={handleId} className='node-port-row-target'>
              <Handle type='target' position={Position.Left} id={handleId} />
              <span>参考图输入 {index + 1}</span>
            </PortRow>
          ))}
        </div>
        <PortRow className='node-port-row-source'>
          <span>提示词输出</span>
          <Handle type='source' position={Position.Right} id='prompt' />
        </PortRow>
      </div>
      <label className='prompt-optimization-select nodrag'>
        <span>优化方向</span>
        <Select
          value={data.optimizationPreset}
          onValueChange={(value) => data.setOptimizationPreset(value as PromptOptimizationPreset)}
        >
          <SelectTrigger>
            <SelectValue placeholder='选择优化方向' />
          </SelectTrigger>
          <SelectContent>
          {data.optimizationPresets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
      </label>
      <div className='prompt-editor nodrag'>
        {hasPromptMentions ? (
          <div className='prompt-highlight-layer' aria-hidden='true'>
            <div
              className='prompt-highlight-content'
              style={{ transform: `translateY(-${promptScrollTop}px)` }}
            >
              {highlightSegments.map((segment, index) =>
                segment.kind === 'text' ? (
                  <span key={`${segment.kind}-${index}`}>{segment.text}</span>
                ) : (
                  <mark
                    key={`${segment.kind}-${index}`}
                    className={`prompt-highlight-mention ${segment.kind === 'missing-mention' ? 'missing' : ''}`}
                  >
                    {segment.text}
                  </mark>
                )
              )}
            </div>
          </div>
        ) : null}
        <Textarea
          ref={textareaRef}
          className='node-textarea prompt-textarea'
          value={data.prompt}
          onChange={(event) => {
            data.setPrompt(event.target.value)
            syncMentionState(event.currentTarget)
          }}
          onKeyDown={handlePromptKeyDown}
          onKeyUp={(event) => syncMentionState(event.currentTarget)}
          onClick={(event) => syncMentionState(event.currentTarget)}
          onScroll={(event) => setPromptScrollTop(event.currentTarget.scrollTop)}
          onBlur={() =>
            window.setTimeout(() => {
              setMentionState(null)
            }, 120)
          }
          placeholder={
            data.generationMode === 'image'
              ? '输入图像生成提示词，例如：使用 @商品图 的包装元素，改成科技海报风格'
            : '产品海报、科技感、高级材质、清晰主视觉；需要参考图时输入 @参考图标题'
          }
        />
        {mentionSummary.length > 0 ? (
          <div className='prompt-reference-summary' aria-label='提示词引用的参考图'>
            {mentionSummary.map((mention) => (
              <span
                key={mention.title}
                className={mention.isKnown ? 'known' : 'missing'}
              >
                @{mention.title}
              </span>
            ))}
          </div>
        ) : null}
        {mentionState ? (
          <div className='prompt-mention-menu'>
            {mentionSuggestions.length > 0 ? (
              mentionSuggestions.map((title, index) => (
                <Button
                  key={title}
                  type='button'
                  variant='ghost'
                  className={index === activeMentionIndex ? 'active' : ''}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    insertMention(title)
                  }}
                >
                  <span>@</span>
                  {title}
                </Button>
              ))
            ) : referenceTitles.length > 0 ? (
              <div className='prompt-mention-empty'>没有匹配的输入端口</div>
            ) : (
              <div className='prompt-mention-empty'>先连接输入端口</div>
            )}
          </div>
        ) : null}
      </div>
    </NodeShell>
  )
}

export function StyleNode({ id, data }: NodeProps<StyleFlowNode>) {
  const selectedStyle =
    data.styles.find((style) => style.id === data.selectedStyleId) || null
  const [category, setCategory] = useState(selectedStyle?.category || '')
  useEffect(() => {
    if (!data.selectedStyleId && data.styles[0]) {
      data.setSelectedStyleId(data.styles[0].id)
    }
  }, [data.selectedStyleId, data.setSelectedStyleId, data.styles])
  useEffect(() => {
    if (selectedStyle && selectedStyle.category !== category) {
      setCategory(selectedStyle.category)
    }
  }, [category, selectedStyle])
  const visibleStyles = useMemo(
    () =>
      category
        ? data.styles.filter((style) => style.category === category)
        : data.styles,
    [category, data.styles]
  )
  const styleKeywords = selectedStyle?.keywords?.slice(0, 4) || []

  return (
    <NodeShell
      id={id}
      accent='blue'
      title='风格选择'
      subtitle='Style'
      onDelete={data.onDeleteNode}
    >
      <div className='node-port-grid style-port-grid'>
        <PortRow className='node-port-row-source'>
          <span>风格输出</span>
          <Handle type='source' position={Position.Right} id='style' />
        </PortRow>
      </div>

      <div className='style-node-body nodrag'>
        <label>
          <span>分类</span>
          <Select
            value={category}
            disabled={data.isLoadingStyles || data.categories.length === 0}
            onValueChange={(nextCategory) => {
              setCategory(nextCategory)
              const firstStyle = data.styles.find((style) =>
                nextCategory ? style.category === nextCategory : true
              )
              data.setSelectedStyleId(firstStyle?.id || '')
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder='全部风格' />
            </SelectTrigger>
            <SelectContent>
            {data.categories.map((item) => (
              <SelectItem key={item.name} value={item.name}>
                {item.name} · {item.count}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>

        <label>
          <span>风格</span>
          <Select
            value={data.selectedStyleId}
            disabled={data.isLoadingStyles || visibleStyles.length === 0}
            onValueChange={data.setSelectedStyleId}
          >
            <SelectTrigger>
              <SelectValue placeholder='暂无风格' />
            </SelectTrigger>
            <SelectContent>
              {visibleStyles.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  {style.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className='style-preview-frame'>
          {selectedStyle?.previewUrl ? (
            <img src={selectedStyle.previewUrl} alt={`${selectedStyle.name} 风格示例`} />
          ) : (
            <div>
              {data.isLoadingStyles ? <Loader2 className='spin' size={28} /> : <Palette size={32} />}
              <span>{data.isLoadingStyles ? 'LOADING' : 'NO STYLE'}</span>
            </div>
          )}
        </div>

        {selectedStyle ? (
          <div className='style-node-meta'>
            <strong>{selectedStyle.category} / {selectedStyle.name}</strong>
            {styleKeywords.length > 0 ? (
              <div>
                {styleKeywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className='style-node-empty'>右侧选择一个风格后，生成时会把对应 JSON 协议加入提示词。</p>
        )}
      </div>
    </NodeShell>
  )
}

export function GenerateNode({ id, data }: NodeProps<GenerateFlowNode>) {
  return (
    <NodeShell
      id={id}
      accent='pink'
      title='图片生成'
      subtitle='Generation'
      onDelete={data.onDeleteNode}
    >
      <label
        className={`image-title-field image-title-field-generate nodrag ${data.isOutputTitleDuplicate ? 'title-conflict' : ''}`}
        title={data.isOutputTitleDuplicate ? '画布内图片名称重复' : '生成图输出名称'}
      >
        <span>@</span>
        <Input
          value={data.outputTitle}
          onChange={(event) => data.updateOutputTitle(event.target.value)}
          aria-invalid={data.isOutputTitleDuplicate}
          placeholder='生成图名称'
          spellCheck={false}
        />
      </label>
      <div className='node-port-grid generate-port-grid'>
        <PortRow className='node-port-row-target'>
          <Handle type='target' position={Position.Left} id='prompt' />
          <span>提示词输入</span>
        </PortRow>
        <PortRow className='node-port-row-source node-port-row-output'>
          <span>生成图片输出</span>
          <Handle type='source' position={Position.Right} id='generated-image' />
        </PortRow>
      </div>
      <div className='generation-preview'>
        {data.image ? (
          <Button
            type='button'
            variant='ghost'
            className='node-preview-button nodrag'
            onClick={() => data.onPreview(data.image!)}
            aria-label='打开生成图片预览'
          >
            <img src={data.image.src} alt={data.image.revisedPrompt || data.image.prompt} />
          </Button>
        ) : data.isGenerating ? (
          <Loader2 className='spin' size={44} />
        ) : (
          <>
            <ImageIcon size={42} />
            <span>NO IMAGE</span>
          </>
        )}
      </div>
      <div className='node-param-grid nodrag'>
        <label>
          <span>模型</span>
          <Select value={data.model} onValueChange={data.setModel}>
            <SelectTrigger>
              <SelectValue placeholder='选择模型' />
            </SelectTrigger>
            <SelectContent>
              {(data.sortedModels.length === 0 ? [{ id: data.model }] : data.sortedModels).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          <span>尺寸</span>
          <Select value={data.size} onValueChange={data.setSize}>
            <SelectTrigger>
              <SelectValue placeholder='选择尺寸' />
            </SelectTrigger>
            <SelectContent>
              {data.sizes.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          <span>质量</span>
          <Select
            value={data.quality}
            onValueChange={data.setQuality}
          >
            <SelectTrigger>
              <SelectValue placeholder='选择质量' />
            </SelectTrigger>
            <SelectContent>
            {data.qualities.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          <span>数量</span>
          <Select value={String(data.count)} onValueChange={(value) => data.setCount(Number(value))}>
            <SelectTrigger>
              <SelectValue placeholder='选择数量' />
            </SelectTrigger>
            <SelectContent>
            {data.counts.map((item) => (
              <SelectItem key={item} value={String(item)}>
                {item}x
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          <span>返回</span>
          <Select
            value={data.responseFormat}
            onValueChange={(value) => data.setResponseFormat(value as 'url' | 'b64_json')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='url'>url</SelectItem>
              <SelectItem value='b64_json'>b64_json</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label>
          <span>保真</span>
          <Select
            value={data.inputFidelity}
            disabled={data.generationMode !== 'image'}
            onValueChange={(value) => data.setInputFidelity(value as 'low' | 'high')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {data.inputFidelities.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className='node-action-bar nodrag'>
        <div>
          <strong>{data.isGenerating ? '等待生成结果' : '等待执行'}</strong>
          <span>{data.isGenerating ? '服务器后台生成中' : '输入提示词后立即生成'}</span>
        </div>
        <Button type='button' onClick={data.onGenerate} disabled={!data.canGenerate}>
          {data.isGenerating ? <Loader2 className='spin' size={16} /> : <Play size={16} />}
          {data.isGenerating ? '等待结果' : '立即生成'}
        </Button>
      </div>
      {data.image ? (
        <div className='output-actions nodrag'>
          <Button type='button' variant='secondary' onClick={() => data.onDownload(data.image!)}>
            <Download size={15} />
            下载结果
          </Button>
          <Button type='button' variant='outline' onClick={() => data.onPreview(data.image!)}>
            打开预览
          </Button>
        </div>
      ) : null}
    </NodeShell>
  )
}

export function OutputNode({ id, data }: NodeProps<OutputFlowNode>) {
  return (
    <NodeShell
      id={id}
      accent='green'
      title='输出预览'
      subtitle='Result'
      onDelete={data.onDeleteNode}
    >
      <Handle type='target' position={Position.Left} />
      <div className='output-frame nodrag'>
        {data.image ? (
          <Button
            type='button'
            variant='ghost'
            onClick={() => data.onPreview(data.image!)}
            aria-label='打开生成图片预览'
          >
            <img src={data.image.src} alt={data.image.revisedPrompt || data.image.prompt} />
          </Button>
        ) : (
          <>
            <ImageIcon size={44} />
            <span>{data.isGenerating ? 'GENERATING' : 'NO OUTPUT'}</span>
          </>
        )}
      </div>
      {data.image ? (
        <div className='output-actions nodrag'>
          <Button type='button' variant='secondary' onClick={() => data.onDownload(data.image!)}>
            <Download size={15} />
            下载
          </Button>
          <Button type='button' variant='outline' onClick={() => data.onPreview(data.image!)}>
            打开预览
          </Button>
        </div>
      ) : null}
    </NodeShell>
  )
}

export function BlueprintEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
}: EdgeProps<BlueprintFlowEdge>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <g className={`edge-interaction ${selected ? 'edge-interaction-selected' : ''}`}>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      <path className='edge-hover-path' d={edgePath} />
    </g>
  )
}

export function GalleryStrip({
  images,
  limit = 8,
  onPreview,
  onDownload,
  onDelete,
}: {
  images: LocalImageRecord[]
  limit?: number
  onPreview: (image: LocalImageRecord) => void
  onDownload: (image: LocalImageRecord, index: number) => void
  onDelete: (id: string) => void
}) {
  const tileClassNames = ['feature', 'tall', 'wide']

  return (
    <div className='gallery-strip'>
      {images.slice(0, limit).map((image, index) => (
        <article
          key={image.id}
          className={`gallery-tile ${tileClassNames[index % tileClassNames.length]}`}
        >
          <button
            type='button'
            className='gallery-tile-preview'
            onClick={() => onPreview(image)}
            aria-label='打开图片预览'
          >
            <img src={image.src} alt={image.revisedPrompt || image.prompt} />
          </button>
          <div className='gallery-tile-overlay'>
            <div className='gallery-tile-copy'>
              <strong>{image.mode === 'image' ? '图片引导' : '文生图'}</strong>
              <span>{new Date(image.createdAt).toLocaleString()}</span>
              <p>{image.revisedPrompt || image.prompt}</p>
            </div>
            <nav aria-label='图片操作'>
              <Button type='button' variant='ghost' size='icon' onClick={() => onDownload(image, index)} aria-label='下载图片'>
                <Download size={14} />
              </Button>
              <Button type='button' variant='ghost' size='icon' onClick={() => onDelete(image.id)} aria-label='删除图片'>
                <Trash2 size={14} />
              </Button>
            </nav>
          </div>
        </article>
      ))}
    </div>
  )
}

export const nodeTypes = {
  asset: AssetNode,
  prompt: PromptNode,
  style: StyleNode,
  generate: GenerateNode,
  output: OutputNode,
}

export const edgeTypes = {
  blueprint: BlueprintEdge,
}
