import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Sky, PointerLockControls, useTexture } from '@react-three/drei'
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { usePlanStore } from '../store/planStore.js'
import {
  spaceVertices, allRenderableWalls, polygonCenter, polygonArea, openingEnds
} from '../lib/constraints.js'

/**
 * 3D 預覽 — Sprint 3 升級:
 *  - 空間 → 多邊形地板 (Shape + ExtrudeGeometry)
 *  - 牆 → 沿著空間邊垂直拉高的盒子,共用邊只算一次
 *  - 門 → 在牆上挖洞 (用 CSG 太貴,先用「兩段牆 + 門框」近似)
 *  - 窗 → 牆上嵌透明玻璃 (近似)
 *  - 光照:Environment HDR + directional
 *  - 單位:1 Three.js unit = 1 公尺 (座標 / 100)
 *
 * v4 加入:
 *  - 底圖 (PDF/JPG) 貼到地板,跟 2D 對齊
 *  - viewMode = 'orbit' | 'topdown' | 'walk' (第一人稱漫遊)
 *  - teleportTo: 傳送相機到某個空間中央
 */
const CM_TO_M = 0.01
const EYE_HEIGHT = 1.65  // 漫遊模式人眼高度

/**
 * 取得「svg unit → meter」係數
 * 2D 編輯的座標是 svg unit;若使用者校準過比例尺,1 svg unit = svgUnitToRealCm cm
 * 預設 1 (svg unit == cm),校準後可能 0.5、2 等
 */
function unitToMeter(plan) {
  return (plan.svgUnitToRealCm || 1) * CM_TO_M
}

// 給所有子元件共用「svg unit → meter」係數,避免 prop drill
const ScaleCtx = createContext(CM_TO_M)
const useScale = () => useContext(ScaleCtx)

/**
 * @param {Object} props
 *   - viewMode: 'orbit' | 'topdown' | 'walk'
 *   - mini: true 為小型嵌入版,關閉控制器、減負載
 *   - teleportTarget: { x, y } cm 座標,設定後相機瞬移到該點 (漫遊用)
 *   - onTeleportDone: 傳送完成後呼叫,父層可清空 target
 */
export default function Canvas3D({
  viewMode = 'orbit',
  mini = false,
  teleportTarget = null,
  onTeleportDone
}) {
  const plan = usePlanStore(s => s.plan)
  const bounds = plan.bounds || { w: 4000, h: 3000 }
  const U = unitToMeter(plan)   // svg unit → meter (含校準)
  const worldW = bounds.w * U
  const worldH = bounds.h * U
  const center = [worldW / 2, 0, worldH / 2]

  // 各 viewMode 的初始相機位置
  const camPos = viewMode === 'topdown'
    ? [center[0], Math.max(worldW, worldH) * 0.8, center[2] + 0.01]
    : viewMode === 'walk'
      ? [center[0], EYE_HEIGHT, center[2] + 5]
      : [center[0] + worldW * 0.5, Math.max(worldW, worldH) * 0.45, center[2] + worldH * 0.7]
  const fov = viewMode === 'topdown' ? 35 : 60   // 透視/漫遊用 60 比較貼近人眼

  return (
    <div className="h-full w-full bg-gradient-to-b from-sky-100 to-slate-50">
      <Canvas shadows camera={{ position: camPos, fov, near: 0.05, far: 1000 }}
              dpr={mini ? 1 : [1, 2]}>
        <ScaleCtx.Provider value={U}>
          {!mini && viewMode !== 'walk' && <Sky sunPosition={[100, 50, 100]} />}
          <ambientLight intensity={0.55} />
          <directionalLight position={[20, 30, 10]} intensity={1.3} castShadow
                            shadow-mapSize-width={mini ? 512 : 1024}
                            shadow-mapSize-height={mini ? 512 : 1024} />
          <hemisphereLight intensity={0.4} groundColor="#cccccc" />
          <Grid args={[Math.max(worldW, worldH) * 4, Math.max(worldW, worldH) * 4]}
                cellSize={1} sectionSize={5}
                cellThickness={0.3} sectionThickness={0.6}
                cellColor="#e2e8f0" sectionColor="#94a3b8"
                infiniteGrid={false} position={[center[0], 0, center[2]]} />

          <FloorPlate bounds={bounds} />
          <BaseLayerFloor plan={plan} />
          <ColumnsLayer plan={plan} />
          <SpacesLayer plan={plan} />
          <WallsLayer3D plan={plan} />
          <FurnitureLayer plan={plan} />
          <LegacyRoomsLayer plan={plan} />

          {!mini && viewMode === 'walk' && (
            <>
              <PointerLockControls />
              <FirstPersonWalker
                teleportTarget={teleportTarget}
                onTeleportDone={onTeleportDone}
                bounds={bounds}
              />
            </>
          )}
          {!mini && viewMode !== 'walk' && (
            <OrbitControls target={center}
                           enableRotate={viewMode !== 'topdown'}
                           enablePan
                           maxPolarAngle={viewMode === 'topdown' ? 0.1 : Math.PI / 2.05}
                           minDistance={1}
                           maxDistance={Math.max(worldW, worldH) * 3}
                           panSpeed={1.2}
                           rotateSpeed={0.9}
                           zoomSpeed={1.0}
                           screenSpacePanning
                           mouseButtons={{
                             // 恢復標準習慣:左鍵旋轉,右鍵 pan,滾輪縮放
                             LEFT: viewMode === 'topdown' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
                             MIDDLE: THREE.MOUSE.DOLLY,
                             RIGHT: THREE.MOUSE.PAN
                           }}
                           touches={{
                             ONE: viewMode === 'topdown' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
                             TWO: THREE.TOUCH.DOLLY_PAN
                           }} />
          )}
        </ScaleCtx.Provider>
      </Canvas>
    </div>
  )
}

// 空間類型 → 地板顏色 (近似不同材質)
const SPACE_FLOOR_COLORS = {
  office:   '#d6c4a1',  // 木紋色 (淺)
  meeting:  '#c5b89a',
  pantry:   '#dcd1c0',
  gym:      '#3f3f46',  // 深灰膠地
  sauna:    '#7c5a3a',  // 深木
  shower:   '#a8c5d9',  // 灰藍磁磚
  locker:   '#bcaa8c',
  lounge:   '#c9b08f',
  restroom: '#d4d4d8',
  corridor: '#e7e5e4',  // 淺米色磁磚
  custom:   '#d6d3d1'
}

// 樓層底盤
function FloorPlate({ bounds }) {
  const U = useScale()
  return (
    <mesh rotation-x={-Math.PI / 2}
          position={[bounds.w * U / 2, 0, bounds.h * U / 2]}
          receiveShadow>
      <planeGeometry args={[bounds.w * U, bounds.h * U]} />
      <meshStandardMaterial color="#f1f5f9" />
    </mesh>
  )
}

/**
 * 底圖 (PDF/JPG) 貼到 3D 地板,跟 2D 對齊
 * 用既有 baseLayer.placement (cm) — 跟 Canvas2D 同一套邏輯
 */
function BaseLayerFloor({ plan }) {
  const U = useScale()
  const baseLayer = plan.baseLayer
  if (!baseLayer) return null
  const imgUrl = baseLayer.type === 'pdf'
    ? baseLayer.previewUrl
    : baseLayer.type === 'image'
      ? baseLayer.publicUrl
      : null
  if (!imgUrl) return null

  // 算 placement (svg unit) — 跟 Canvas2D BaseLayerRender 同一邏輯
  let p = baseLayer.placement
  if (!p) {
    const t = baseLayer.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
    const W = baseLayer.width || 1000
    const H = baseLayer.height || 1000
    const svgW = plan.bounds?.w || 4000
    const svgH = plan.bounds?.h || 3000
    const fit = Math.min((svgW * 0.9) / W, (svgH * 0.9) / H)
    const s = fit * (t.scale || 1)
    p = {
      drawW: W * s,
      drawH: H * s,
      offsetX: (svgW - W * s) / 2 + (t.x || 0),
      offsetY: (svgH - H * s) / 2 + (t.y || 0),
      rotation: t.rotation || 0,
      opacity: baseLayer.opacity ?? 0.6
    }
  }

  // 中心位置 (svg unit → m,含校準)
  const cx = (p.offsetX + p.drawW / 2) * U
  const cz = (p.offsetY + p.drawH / 2) * U
  const w = p.drawW * U
  const h = p.drawH * U

  return (
    <group position={[cx, 0.003, cz]} rotation-y={-(p.rotation || 0) * Math.PI / 180}>
      <BaseLayerMesh url={imgUrl} w={w} h={h} opacity={p.opacity ?? 0.6} />
    </group>
  )
}

function BaseLayerMesh({ url, w, h, opacity }) {
  // useTexture suspends until ready — Canvas 預設有 Suspense fallback
  const tex = useTexture(url)
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} transparent opacity={opacity}
                            roughness={0.95} metalness={0} />
    </mesh>
  )
}

// 結構柱
function ColumnsLayer({ plan }) {
  const U = useScale()
  return (<>
    {(plan.structuralColumns || []).map((c, i) => {
      const w = c.w * U, d = c.h * U, h = 3
      const cx = (c.x + c.w/2) * U, cz = (c.y + c.h/2) * U
      return (
        <mesh key={i} position={[cx, h/2, cz]} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
      )
    })}
  </>)
}

// 空間地板:多邊形 shape extrude 一點點高度當地板
function SpacesLayer({ plan }) {
  return (<>
    {(plan.spaces || []).map(sp => <SpaceFloor key={sp.id} space={sp} />)}
  </>)
}

function SpaceFloor({ space }) {
  const U = useScale()
  const vs = spaceVertices(space)
  const geom = useMemo(() => {
    if (vs.length < 3) return null
    const shape = new THREE.Shape()
    shape.moveTo(vs[0].x * U, vs[0].y * U)
    for (let i = 1; i < vs.length; i++) {
      shape.lineTo(vs[i].x * U, vs[i].y * U)
    }
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [JSON.stringify(vs), U])
  if (!geom) return null
  // 依空間類型挑材質色 (近似不同地材)
  const floorColor = SPACE_FLOOR_COLORS[space.type] || space.color || '#d6d3d1'
  return (
    <mesh geometry={geom} rotation-x={Math.PI / 2} position={[0, 0.008, 0]} receiveShadow>
      <meshStandardMaterial color={floorColor} roughness={0.7} metalness={0.05}
                            transparent opacity={0.85} />
    </mesh>
  )
}

// 牆:以線段為中心,用 BoxGeometry 拉高
function WallsLayer3D({ plan }) {
  // allRenderableWalls 已經把共邊標 isShared,跳過不畫即可
  const walls = useMemo(() => {
    return allRenderableWalls(plan).filter(w => !w.isShared)
  }, [JSON.stringify(plan.walls || []), JSON.stringify(plan.spaces || [])])

  // 為每面牆找關聯的門/窗 (依 wallId)
  const openingsByWallId = useMemo(() => {
    const map = {}
    for (const d of (plan.doors || [])) {
      if (!map[d.wallId]) map[d.wallId] = { doors: [], windows: [] }
      map[d.wallId].doors.push(d)
    }
    for (const w of (plan.windows || [])) {
      if (!map[w.wallId]) map[w.wallId] = { doors: [], windows: [] }
      map[w.wallId].windows.push(w)
    }
    return map
  }, [JSON.stringify(plan.doors || []), JSON.stringify(plan.windows || [])])

  return (<>
    {walls.map((w, i) => <WallSegment3D key={w.id || i} wall={w}
                                        openings={openingsByWallId[w.id]} />)}
  </>)
}

function WallSegment3D({ wall, openings }) {
  const U = useScale()
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1
  const len = Math.sqrt(dx * dx + dy * dy) * U
  if (len === 0) return null
  const angle = Math.atan2(dy, dx)  // X 軸到 (dx,dy) 的角度
  // 牆厚跟門窗寬度本來就是 cm,所以用 CM_TO_M(不受校準影響,牆厚 12cm 永遠是 12cm)
  const thickness = (wall.thickness ?? 12) * CM_TO_M
  const height = 2.8  // 預設樓高 280cm
  const cx = (wall.x1 + wall.x2) / 2 * U
  const cz = (wall.y1 + wall.y2) / 2 * U
  // 牆面塗料色 (溫暖米白,接近酷家樂風格)
  const color = wall.kind === 'exterior' ? '#e8e1d4' : '#f5efe4'

  // 計算每個開口 (門/窗) 沿牆的 [t1, t2] 範圍
  const holes = []
  for (const d of (openings?.doors || [])) {
    const halfW = d.width / 2 / (len * 100)
    holes.push({ t1: Math.max(0, d.t - halfW), t2: Math.min(1, d.t + halfW), kind: 'door', y: [0, 2.1] })
  }
  for (const w of (openings?.windows || [])) {
    const halfW = w.width / 2 / (len * 100)
    const sill = (w.sillHeight ?? 90) / 100
    holes.push({ t1: Math.max(0, w.t - halfW), t2: Math.min(1, w.t + halfW), kind: 'window', y: [sill, sill + 1.2] })
  }
  // 把整面牆切成多段 (沿 t 軸切),每段再依高度切 (門上方還是有牆)
  // 為簡化:門口 = 中段牆只到地面(沒牆);窗口 = 上半 + 下半保留
  const segments = []
  let cursor = 0
  const sortedHoles = [...holes].sort((a, b) => a.t1 - b.t1)
  for (const h of sortedHoles) {
    if (h.t1 > cursor) segments.push({ t1: cursor, t2: h.t1, type: 'full' })
    if (h.kind === 'door') {
      // 門上方仍有牆 (門高 2.1, 樓高 2.8 → 上面 0.7m)
      segments.push({ t1: h.t1, t2: h.t2, type: 'lintel', yBottom: h.y[1], yTop: height })
    } else if (h.kind === 'window') {
      // 窗下方有牆 (sill 以下),窗上方有牆 (sill+1.2 以上)
      segments.push({ t1: h.t1, t2: h.t2, type: 'sill', yBottom: 0, yTop: h.y[0] })
      segments.push({ t1: h.t1, t2: h.t2, type: 'lintel', yBottom: h.y[1], yTop: height })
      segments.push({ t1: h.t1, t2: h.t2, type: 'glass', yBottom: h.y[0], yTop: h.y[1] })
    }
    cursor = Math.max(cursor, h.t2)
  }
  if (cursor < 1) segments.push({ t1: cursor, t2: 1, type: 'full' })

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {segments.map((s, i) => {
        const segLen = (s.t2 - s.t1) * len
        if (segLen <= 0) return null
        const segCx = (s.t1 + s.t2) / 2 * len - len / 2
        if (s.type === 'full') {
          return (
            <mesh key={i} position={[segCx, height/2, 0]} castShadow receiveShadow>
              <boxGeometry args={[segLen, height, thickness]} />
              <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
            </mesh>
          )
        }
        if (s.type === 'lintel' || s.type === 'sill') {
          const h = s.yTop - s.yBottom
          return (
            <mesh key={i} position={[segCx, s.yBottom + h/2, 0]} castShadow>
              <boxGeometry args={[segLen, h, thickness]} />
              <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
            </mesh>
          )
        }
        if (s.type === 'glass') {
          const h = s.yTop - s.yBottom
          return (
            <mesh key={i} position={[segCx, s.yBottom + h/2, 0]}>
              <boxGeometry args={[segLen, h, thickness * 0.3]} />
              <meshStandardMaterial color="#bae6fd" opacity={0.4} transparent />
            </mesh>
          )
        }
      })}
    </group>
  )
}

// 家具 (家具尺寸是 svg unit,位置也是,要套校準)
function FurnitureLayer({ plan }) {
  const U = useScale()
  return (<>
    {(plan.furniture || []).map(f => {
      const w = f.w * U, d = f.h * U
      const h = (f.height ?? 80) * CM_TO_M    // height 屬性是 cm 不受校準
      const cx = (f.x + f.w/2) * U, cz = (f.y + f.h/2) * U
      return (
        <mesh key={f.id} position={[cx, h/2, cz]}
              rotation-y={(f.rot ?? 0) * Math.PI / 180} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={f.color ?? '#64748b'} />
        </mesh>
      )
    })}
  </>)
}

// Legacy 房間 (還沒升級成 spaces 的舊資料)
function LegacyRoomsLayer({ plan }) {
  const U = useScale()
  // 如果已經有 spaces,就不畫舊 rooms,避免重疊
  if ((plan.spaces || []).length > 0) return null
  return (<>
    {(plan.rooms || []).map(r => {
      const w = r.w * U, h = r.h * U
      const height = (r.height ?? 280) * CM_TO_M
      const wallT = 0.1
      const cx = (r.x + r.w/2) * U, cz = (r.y + r.h/2) * U
      return (
        <group key={r.id} position={[cx, 0, cz]}>
          <mesh position={[0, 0.001, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color={r.color ?? '#e2e8f0'} />
          </mesh>
          {[
            { p: [0, height/2,  h/2], s: [w, height, wallT] },
            { p: [0, height/2, -h/2], s: [w, height, wallT] },
            { p: [ w/2, height/2, 0], s: [wallT, height, h] },
            { p: [-w/2, height/2, 0], s: [wallT, height, h] }
          ].map((wall, i) => (
            <mesh key={i} position={wall.p}>
              <boxGeometry args={wall.s} />
              <meshStandardMaterial color="#cbd5e1" transparent opacity={0.5} />
            </mesh>
          ))}
        </group>
      )
    })}
  </>)
}

/**
 * 第一人稱漫遊:WASD 移動 + 傳送
 * - 滑鼠視角由 PointerLockControls 控制 (drei 內建)
 * - W/A/S/D 或 方向鍵移動,Shift 加速,Space 跳 (簡化:就是 y bobbing 略過)
 * - teleportTarget 變動時瞬移
 */
function FirstPersonWalker({ teleportTarget, onTeleportDone, bounds }) {
  const { camera } = useThree()
  const U = useScale()
  const keys = useRef({ w: false, a: false, s: false, d: false, shift: false })

  // 鍵盤事件監聽
  useEffect(() => {
    const map = {
      'w': 'w', 'arrowup': 'w',
      's': 's', 'arrowdown': 's',
      'a': 'a', 'arrowleft': 'a',
      'd': 'd', 'arrowright': 'd',
      'shift': 'shift'
    }
    const onDown = (e) => {
      const k = map[e.key.toLowerCase()]
      if (k) { keys.current[k] = true; if (k !== 'shift') e.preventDefault() }
    }
    const onUp = (e) => {
      const k = map[e.key.toLowerCase()]
      if (k) keys.current[k] = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  // 傳送
  useEffect(() => {
    if (!teleportTarget) return
    camera.position.set(
      teleportTarget.x * U,
      EYE_HEIGHT,
      teleportTarget.y * U
    )
    onTeleportDone?.()
  }, [teleportTarget, camera, onTeleportDone, U])

  // 每幀依按鍵更新位置 — 速度加快讓巡視大空間順手
  useFrame((_, delta) => {
    const baseSpeed = keys.current.shift ? 16 : 8  // m/s
    const dist = baseSpeed * delta
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) return
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    if (keys.current.w) camera.position.addScaledVector(forward, dist)
    if (keys.current.s) camera.position.addScaledVector(forward, -dist)
    if (keys.current.a) camera.position.addScaledVector(right, -dist)
    if (keys.current.d) camera.position.addScaledVector(right, dist)
    // 鎖定眼高 + 限制不要走出 bounds 太遠
    camera.position.y = EYE_HEIGHT
    const worldW = bounds.w * U
    const worldH = bounds.h * U
    const pad = Math.max(worldW, worldH) * 0.2
    camera.position.x = Math.max(-pad, Math.min(worldW + pad, camera.position.x))
    camera.position.z = Math.max(-pad, Math.min(worldH + pad, camera.position.z))
  })

  return null
}
