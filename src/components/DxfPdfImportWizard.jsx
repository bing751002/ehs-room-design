import { useState } from 'react'
import DxfParser from 'dxf-parser'
import { usePlanStore } from '../store/planStore.js'
import { decodeDxfText } from '../lib/dxfSpaceExtract.js'
import {
  buildDxfPdfImportPreview,
  extractPdfImportData,
  importRoomsToSpaces,
} from '../lib/dxfPdfImport.js'
import { newSpaceId } from '../lib/constraints.js'

export default function DxfPdfImportWizard() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const [dxfFile, setDxfFile] = useState(null)
  const [pdfFile, setPdfFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [view, setView] = useState('rooms')

  async function runPreview() {
    if (!dxfFile || !pdfFile) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const dxfText = decodeDxfText(await dxfFile.arrayBuffer())
      const dxf = new DxfParser().parseSync(dxfText)
      const pdfData = await extractPdfImportData(pdfFile)
      const preview = buildDxfPdfImportPreview({
        dxf,
        textItems: pdfData.textItems,
        crop: pdfData.crop,
        imageHref: pdfData.imageHref,
        pdfColumns: pdfData.pdfColumns,
      })
      setResult({
        ...preview,
        crop: pdfData.crop,
        imageHref: pdfData.imageHref,
        files: { dxf: dxfFile.name, pdf: pdfFile.name },
      })
      setView('rooms')
    } catch (ex) {
      console.error(ex)
      setError(ex.message || 'DXF/PDF import failed')
    } finally {
      setBusy(false)
    }
  }

  function applyRooms() {
    if (!result) return
    const spaces = importRoomsToSpaces(result.rooms, result.crop, plan.bounds)
      .map(space => ({ id: newSpaceId(), ...space }))
    if (!spaces.length) {
      setError('No reliable DXF-frame rooms to apply yet.')
      return
    }
    setPlan({
      ...plan,
      spaces,
      rooms: [],
      walls: [],
      doors: [],
      windows: [],
      importPreview: {
        source: 'dxf-pdf',
        files: result.files,
        meta: result.meta,
        appliedAt: Date.now(),
      },
    })
  }

  const canRun = dxfFile && pdfFile && !busy
  const reliableCount = result?.rooms?.filter(room => room.geometrySource === 'dxf-frame').length || 0

  return (
    <div className="rounded border bg-white p-2 text-xs shadow-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-medium text-slate-700">DXF + PDF import</div>
        <label className="px-2 py-1 rounded border bg-slate-50 hover:bg-slate-100 cursor-pointer">
          DXF
          <input
            type="file"
            accept=".dxf"
            className="hidden"
            onChange={e => setDxfFile(e.target.files?.[0] || null)}
          />
        </label>
        <span className="max-w-[150px] truncate text-slate-500" title={dxfFile?.name || ''}>
          {dxfFile?.name || 'No DXF'}
        </span>
        <label className="px-2 py-1 rounded border bg-slate-50 hover:bg-slate-100 cursor-pointer">
          PDF
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => setPdfFile(e.target.files?.[0] || null)}
          />
        </label>
        <span className="max-w-[150px] truncate text-slate-500" title={pdfFile?.name || ''}>
          {pdfFile?.name || 'No PDF'}
        </span>
        <button
          type="button"
          disabled={!canRun}
          onClick={runPreview}
          className="px-3 py-1 rounded bg-brand-700 text-white disabled:opacity-40"
        >
          {busy ? 'Processing...' : 'Preview'}
        </button>
        {result && (
          <button
            type="button"
            onClick={applyRooms}
            className="px-3 py-1 rounded border border-green-500 bg-green-50 text-green-700"
          >
            Apply {reliableCount} rooms
          </button>
        )}
        {result && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setView('rooms')}
              className={`px-2 py-1 rounded border ${view === 'rooms' ? 'bg-slate-800 text-white' : 'bg-white'}`}
            >
              Rooms
            </button>
            <button
              type="button"
              onClick={() => setView('alignment')}
              className={`px-2 py-1 rounded border ${view === 'alignment' ? 'bg-slate-800 text-white' : 'bg-white'}`}
            >
              Alignment
            </button>
            <button
              type="button"
              onClick={() => setView('diagnostics')}
              className={`px-2 py-1 rounded border ${view === 'diagnostics' ? 'bg-slate-800 text-white' : 'bg-white'}`}
            >
              Diagnostics
            </button>
          </div>
        )}
      </div>

      {error && <div className="mt-2 text-red-600">{error}</div>}

      {result && (
        <div className="mt-2">
          <div className="mb-2 flex gap-3 text-slate-600 flex-wrap">
            <span>labels {result.meta.labelCount}</span>
            <span>matched {result.meta.matchedRoomCount}</span>
            <span>unresolved {result.meta.unresolvedRoomCount}</span>
            <span>open estimates {result.meta.estimatedRoomCount}</span>
            <span>small estimates {result.meta.smallRoomEstimateCount}</span>
            <span>alignment {result.meta.alignmentMethod}</span>
            <span>columns {result.meta.columnAnchorCount}</span>
            <span>pdf cols {result.meta.pdfColumnCount}</span>
            <span>residual {result.meta.columnResidualMedian ?? '-'} / {result.meta.columnResidualMax ?? '-'}</span>
            <span>diagnostics {result.meta.diagnosticRoomCount}</span>
            <span>walls {result.meta.diagnosticWallCandidateCount}</span>
          </div>
          <div
            className="h-72 overflow-auto rounded border bg-white"
            dangerouslySetInnerHTML={{
              __html: view === 'rooms'
                ? result.roomSvg
                : view === 'diagnostics'
                  ? result.diagnosticsSvg
                  : result.alignmentSvg,
            }}
          />
        </div>
      )}
    </div>
  )
}
