import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { newSpaceId, newDoorId, newWindowId } from '../lib/constraints.js'
import { buildDxfPdfSpacesFromBaseLayer, openingsToPlanDoorsWindows } from '../lib/dxfPdfDeterministicImport.js'
import { recognizeSmallRoomDoorsVision } from '../lib/aiVisionDoors.js'
import { matchSmallRoomCellsVision } from '../lib/aiVisionCellMatch.js'

export default function DxfPdfFrameButton() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('vision-cell')
  const baseLayer = plan.baseLayer

  if (baseLayer?.importMode !== 'dxf-pdf') return null

  function isSmallSpace(space) {
    return Number.isFinite(space?.ping) && space.ping <= 6
  }

  function cropToSvg(point, crop, placement, bounds) {
    const canvasBounds = bounds || { w: 4000, h: 3000 }
    const ok = placement && Number.isFinite(placement.offsetX) && Number.isFinite(placement.offsetY) &&
      Number.isFinite(placement.drawW) && Number.isFinite(placement.drawH) && placement.drawW > 0 && placement.drawH > 0
    const fit = ok ? null : Math.min((canvasBounds.w * 0.9) / crop.width, (canvasBounds.h * 0.9) / crop.height)
    const drawW = ok ? placement.drawW : crop.width * fit
    const drawH = ok ? placement.drawH : crop.height * fit
    const offsetX = ok ? placement.offsetX : (canvasBounds.w - drawW) / 2
    const offsetY = ok ? placement.offsetY : (canvasBounds.h - drawH) / 2
    return {
      x: Math.round(offsetX + (point.x / crop.width) * drawW),
      y: Math.round(offsetY + (point.y / crop.height) * drawH),
    }
  }

  function matchedCellToSpace(match, crop) {
    return {
      id: newSpaceId(),
      name: match.name,
      ping: match.label.ping,
      matchedPing: match.label.ping,
      framePing: match.cell.framePing,
      source: 'dxf-pdf-vision-cell-match',
      labelPlacement: 'vision-cell-match',
      visionCellMatchConfidence: match.confidence,
      height: 280,
      color: '#e2e8f0',
      wallKind: 'interior',
      wallThickness: 12,
      labelPosition: cropToSvg(match.label.pdfPoint, crop, baseLayer.placement, plan.bounds),
      vertices: match.cell.polygonPdf.map(point => cropToSvg(point, crop, baseLayer.placement, plan.bounds)),
    }
  }

  function bboxOfSpace(space) {
    const xs = (space.vertices || []).map(point => point.x)
    const ys = (space.vertices || []).map(point => point.y)
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    }
  }

  function overlapRatio(a, b) {
    const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
    const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
    const inter = ix * iy
    const areaA = Math.max(1, (a.maxX - a.minX) * (a.maxY - a.minY))
    const areaB = Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY))
    return inter / Math.min(areaA, areaB)
  }

  async function applyFrames() {
    setErr('')
    setBusy(true)
    try {
      const result = buildDxfPdfSpacesFromBaseLayer(baseLayer, plan.bounds)
      if (!result.spaces.length) {
        setErr('目前沒有可直接套用的 DXF/PDF 高信心房間框')
        return
      }
      console.info('[DXF+PDF deterministic import]', result.meta)
      const deterministicSpaces = result.spaces.map(space => ({ id: newSpaceId(), ...space }))
      let spaces = deterministicSpaces
      const crop = baseLayer.pdfImport?.crop
      const preview = baseLayer.pdfImport?.preview
      const useVisionCellMatch = mode === 'vision-cell' || mode === 'vision-cell-doors'
      if (useVisionCellMatch && crop && baseLayer.pdfImport?.imageHref && preview?.labels?.length && preview?.candidateCells?.length) {
        try {
          const matches = await matchSmallRoomCellsVision({
            imageUrl: baseLayer.pdfImport.imageHref,
            labels: preview.labels,
            candidateCells: preview.candidateCells,
            crop,
          })
          if (matches.length) {
            const matchedSmallSpaces = matches.map(match => matchedCellToSpace(match, crop))
            const matchedBoxes = matchedSmallSpaces.map(bboxOfSpace)
            const deterministicSmallFallback = deterministicSpaces
              .filter(isSmallSpace)
              .filter(space => {
                const box = bboxOfSpace(space)
                return !matchedBoxes.some(matchedBox => overlapRatio(box, matchedBox) > 0.35)
              })
            spaces = [
              ...deterministicSpaces.filter(space => !isSmallSpace(space)),
              ...deterministicSmallFallback,
              ...matchedSmallSpaces,
            ]
          }
        } catch (e) {
          console.warn('[DXF+PDF 小房間 cell VisionLM 配對] 失敗,保留 deterministic 小房間:', e)
        }
      }
      const deterministicDoors = (result.doors || []).filter(door => !isSmallSpace(deterministicSpaces[door.spaceIndex]))
      const deterministicWindows = (result.windows || []).filter(win => !isSmallSpace(deterministicSpaces[win.spaceIndex]))
      const { doors: largeDoors, windows } = openingsToPlanDoorsWindows(
        { doors: deterministicDoors, windows: deterministicWindows }, deterministicSpaces, { door: newDoorId, window: newWindowId }
      )
      const smallSpaces = spaces.filter(isSmallSpace)
      let smallDoors = []
      const useSmallRoomVisionDoors = mode === 'vision-cell-doors'
      if (useSmallRoomVisionDoors && smallSpaces.length && baseLayer.pdfImport?.imageHref && crop) {
        try {
          smallDoors = await recognizeSmallRoomDoorsVision({
            imageUrl: baseLayer.pdfImport.imageHref,
            spaces: smallSpaces,
            crop,
            placement: baseLayer.placement,
            bounds: plan.bounds,
            idFns: { door: newDoorId },
            doorCandidates: preview?.openings?.doors || [],
          })
        } catch (e) {
          console.warn('[DXF+PDF 小房間門洞 VisionLM] 失敗,略過小房間門:', e)
        }
      }
      const doors = [...largeDoors, ...smallDoors]
      const validWallIds = new Set(spaces.flatMap(space => (space.vertices || []).map((_, index) => `edge-${space.id}-${index}`)))
      const invalidDoors = doors.filter(door => !validWallIds.has(door.wallId))
      console.info('[DXF+PDF frame apply result]', {
        mode,
        spaces: spaces.length,
        largeDoors: largeDoors.length,
        smallDoors: smallDoors.length,
        invalidDoors: invalidDoors.length,
        invalidDoorRefs: invalidDoors.map(door => ({ wallId: door.wallId, source: door.source })),
        windows: windows.length,
      })
      const latestPlan = usePlanStore.getState().plan
      setPlan({
        ...latestPlan,
        spaces,
        rooms: [],
        walls: [],
        doors,
        windows,
        importPreview: {
          source: result.source,
          meta: {
            ...result.meta,
            smallRoomDoorMode: useSmallRoomVisionDoors && smallSpaces.length ? 'vision' : 'none',
            smallRoomDoorCount: smallDoors.length,
            largeDoorCount: largeDoors.length,
            invalidDoorCount: invalidDoors.length,
            importMode: mode,
          },
          appliedAt: Date.now(),
        },
      })
      alert(`已用 DXF+PDF 直接建立 ${spaces.length} 個房間框 / ${doors.length} 門 / ${windows.length} 窗。\n大房間門: ${largeDoors.length}\n小房間門: ${smallDoors.length}\n無效門參照: ${invalidDoors.length}`)
    } finally {
      setBusy(false)
    }
  }

  const matched = baseLayer.pdfImport?.preview?.meta?.matchedRoomCount ?? 0

  return (
    <>
      <select
        value={mode}
        onChange={event => setMode(event.target.value)}
        disabled={busy}
        className="px-2 py-1 rounded border text-xs bg-white disabled:opacity-50"
        title="切換 DXF+PDF 直接框房間的小房間策略"
      >
        <option value="deterministic">穩定框</option>
        <option value="vision-cell">連連看框</option>
        <option value="vision-cell-doors">連連看框+AI門</option>
      </select>
      <button
        type="button"
        onClick={applyFrames}
        disabled={busy}
        className="px-3 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500 disabled:opacity-50"
        title="不呼叫 Gemini；只用 PDF 文字 + DXF 對位房間框建立 spaces"
      >
        {busy ? 'DXF+PDF 框房間中…' : `DXF+PDF 直接框房間${matched ? ` (${matched})` : ''}`}
      </button>
      {err && <span className="text-red-600 text-[10px]">{err}</span>}
    </>
  )
}
