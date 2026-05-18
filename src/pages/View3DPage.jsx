import Canvas3D from '../components/Canvas3D.jsx'

/**
 * 全螢幕 3D 預覽 — Sprint 3 會升級材質、光照、家具 GLB。
 * 目前用現有 Canvas3D。
 */
export default function View3DPage() {
  return (
    <div className="h-full w-full">
      <Canvas3D />
    </div>
  )
}
