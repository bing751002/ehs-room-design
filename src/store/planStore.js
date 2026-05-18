import { create } from 'zustand'
import { supabase } from '../lib/supabase.js'
import {
  emptyPlan, newWallId, newDoorId, newWindowId, newSpaceId,
  extractFloorSnapshot, mergeFloorSnapshot, newId
} from '../lib/constraints.js'

// 撤銷重做用的歷史堆疊 (只記 plan,不含 meta)
const HISTORY_LIMIT = 50

/**
 * Zustand 全域狀態
 * - plan:當前方案資料(房間、家具、走道、保留區、結構柱)
 * - selectedId:目前選中的元素 id
 * - load / save / update:跟 Supabase 同步
 *
 * Realtime:在 Editor 元件裡訂閱 plans 表的變更,把推送進來的 row 寫入這個 store,
 * 達到多人即時同步效果。
 */
export const usePlanStore = create((set, get) => ({
  planId: null,
  meta: { title: '', floor_label: '' },
  plan: emptyPlan(),
  selectedId: null,
  saving: false,
  remoteVersion: 0,  // 用來避免 echo 自己的更新

  // 校準比例尺暫存狀態 (不存到雲端,只有當前 session)
  calibMode: false,        // 是否正在「點兩點」模式
  calibPoints: [],         // [{x, y}, ...] 已點的點 (最多 2)

  // 編輯模式 (session-only): select / measure / add-wall / add-door / add-window / add-space
  editMode: 'select',
  setEditMode: (m) => set({ editMode: m }),

  // 畫布縮放比例 (給 SpacePolygon 等讀)
  canvasZoom: 0.15,
  setCanvasZoom: (z) => set({ canvasZoom: z }),

  // 多選 ids (Shift+click 累加)
  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelectedId: (id) => set(s => ({
    selectedIds: s.selectedIds.includes(id)
      ? s.selectedIds.filter(x => x !== id)
      : [...s.selectedIds, id]
  })),

  // 剪貼簿 (Cmd+C 暫存)
  clipboard: null,
  setClipboard: (c) => set({ clipboard: c }),

  // 量距離工具:點兩點記錄結果
  measurePoints: [],
  pinnedMeasures: [],  // 釘住的量測結果 [{a:{x,y}, b:{x,y}, label}]
  addMeasurePoint: (p) => set(s => ({
    measurePoints: s.measurePoints.length >= 2 ? [p] : [...s.measurePoints, p]
  })),
  clearMeasurePoints: () => set({ measurePoints: [] }),
  pinCurrentMeasure: () => {
    const s = get()
    if (s.measurePoints.length !== 2) return
    const [a, b] = s.measurePoints
    set({
      pinnedMeasures: [...s.pinnedMeasures, { a, b }],
      measurePoints: []
    })
  },
  removePinnedMeasure: (idx) => set(s => ({
    pinnedMeasures: s.pinnedMeasures.filter((_, i) => i !== idx)
  })),
  clearAllPinnedMeasures: () => set({ pinnedMeasures: [] }),

  // 加牆中: 點第一點後暫存
  pendingWallStart: null,
  setPendingWallStart: (p) => set({ pendingWallStart: p }),

  // 撤銷重做歷史 (session-only,雲端只存最新狀態)
  history: { stack: [], pointer: -1 },

  setSelected: (id) => set({ selectedId: id }),
  setCalibMode: (on) => set({ calibMode: on, calibPoints: [] }),
  addCalibPoint: (p) => set(s => ({
    calibPoints: s.calibPoints.length >= 2 ? [p] : [...s.calibPoints, p]
  })),
  clearCalibPoints: () => set({ calibPoints: [] }),

  async load(id) {
    const { data, error } = await supabase
      .from('plans').select('*').eq('id', id).single()
    if (error) { console.error(error); return }
    const plan = { ...emptyPlan(), ...(data.data || {}) }
    set({
      planId: data.id,
      meta: { title: data.title, floor_label: data.floor_label },
      plan,
      remoteVersion: Date.now(),
      history: { stack: [JSON.stringify(plan)], pointer: 0 }
    })
  },

  async save() {
    const { planId, plan, meta } = get()
    if (!planId) return
    set({ saving: true })
    const { error } = await supabase.from('plans')
      .update({ data: plan, title: meta.title, floor_label: meta.floor_label })
      .eq('id', planId)
    set({ saving: false })
    if (error) console.error(error)
  },

  applyRemote(row) {
    if (!row || row.id !== get().planId) return
    set({
      meta: { title: row.title, floor_label: row.floor_label },
      plan: { ...emptyPlan(), ...(row.data || {}) },
      remoteVersion: Date.now()
    })
  },

  // ----- 編輯動作(本地立即更新,並把整個 plan 推回雲端) -----
  addRoom(room) {
    set(s => ({ plan: { ...s.plan, rooms: [...s.plan.rooms, room] } }))
    get().save()
  },
  updateRoom(id, patch) {
    set(s => ({
      plan: {
        ...s.plan,
        rooms: s.plan.rooms.map(r => r.id === id ? { ...r, ...patch } : r)
      }
    }))
    get().saveDebounced()
  },
  removeRoom(id) {
    set(s => ({ plan: { ...s.plan, rooms: s.plan.rooms.filter(r => r.id !== id) } }))
    get().save()
  },
  addFurniture(f) {
    set(s => ({ plan: { ...s.plan, furniture: [...s.plan.furniture, f] } }))
    get().save()
  },
  updateFurniture(id, patch) {
    set(s => ({
      plan: {
        ...s.plan,
        furniture: s.plan.furniture.map(f => f.id === id ? { ...f, ...patch } : f)
      }
    }))
    get().saveDebounced()
  },
  removeFurniture(id) {
    set(s => ({ plan: { ...s.plan, furniture: s.plan.furniture.filter(f => f.id !== id) } }))
    get().save()
  },
  setBaseLayer(baseLayer) {
    set(s => ({ plan: { ...s.plan, baseLayer } }))
    get().save()
  },

  /**
   * 套用比例尺校準。改良版:
   *  - 不再動 baseLayer.transform.scale (避免整張底圖跳大跳小)
   *  - 改成記錄「1 svg 單位 = X 真實 cm」的係數,所有坪數/量距離讀這個
   *  - svgUnitToRealCm 存在 plan 頂層,方便牆/空間共用
   */
  applyScaleCalibration({ method, svgPx, realCm, ratio, note }) {
    const s = get()
    const bl = s.plan.baseLayer
    let factor = 1  // 1 svg unit = factor 真實 cm
    if (method === 'two-point') {
      if (!svgPx || !realCm) return
      factor = realCm / svgPx
    } else if (method === 'ratio') {
      // ratio = 1:X,代表 svg 1 單位 = ratio 真實 cm (假設底圖已是 1mm:1unit 之類)
      factor = Number(ratio)
    } else if (method === 'ai') {
      if (!svgPx || !realCm) return
      factor = realCm / svgPx
    }
    if (!isFinite(factor) || factor <= 0) return

    set(state => ({
      plan: {
        ...state.plan,
        svgUnitToRealCm: factor,  // 1 svg unit = factor 真實 cm
        baseLayer: bl ? {
          ...bl,
          scaleCalibration: { method, svgPx, realCm, ratio, factor, calibratedAt: Date.now(), note }
        } : bl
      }
    }))
    get().save()
  },

  setBounds(bounds) {
    set(s => ({ plan: { ...s.plan, bounds } }))
    get().save()
  },

  // 整段覆寫 plan (AI 一次回多項變更時用)
  setPlan(newPlan) {
    get()._pushHistory()
    set({ plan: newPlan })
    get().save()
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 牆 actions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addWall(wall) {
    get()._pushHistory()
    const w = { id: newWallId(), thickness: 12, kind: 'interior', ...wall }
    set(s => ({ plan: { ...s.plan, walls: [...(s.plan.walls || []), w] } }))
    get().save()
    return w.id
  },
  updateWall(id, patch) {
    set(s => ({
      plan: { ...s.plan, walls: (s.plan.walls || []).map(w => w.id === id ? { ...w, ...patch } : w) }
    }))
    get().saveDebounced()
  },
  removeWall(id) {
    get()._pushHistory()
    set(s => ({
      plan: {
        ...s.plan,
        walls:   (s.plan.walls   || []).filter(w => w.id !== id),
        doors:   (s.plan.doors   || []).filter(d => d.wallId !== id),
        windows: (s.plan.windows || []).filter(w => w.wallId !== id)
      }
    }))
    get().save()
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 門 / 窗 / 空間 actions
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addDoor(door) {
    get()._pushHistory()
    const d = { id: newDoorId(), width: 90, swing: 'in-right', t: 0.5, ...door }
    set(s => ({ plan: { ...s.plan, doors: [...(s.plan.doors || []), d] } }))
    get().save()
    return d.id
  },
  updateDoor(id, patch) {
    set(s => ({
      plan: { ...s.plan, doors: (s.plan.doors || []).map(d => d.id === id ? { ...d, ...patch } : d) }
    }))
    get().saveDebounced()
  },
  removeDoor(id) {
    get()._pushHistory()
    set(s => ({ plan: { ...s.plan, doors: (s.plan.doors || []).filter(d => d.id !== id) } }))
    get().save()
  },
  addWindow(win) {
    get()._pushHistory()
    const w = { id: newWindowId(), width: 150, t: 0.5, sillHeight: 90, ...win }
    set(s => ({ plan: { ...s.plan, windows: [...(s.plan.windows || []), w] } }))
    get().save()
    return w.id
  },
  updateWindow(id, patch) {
    set(s => ({
      plan: { ...s.plan, windows: (s.plan.windows || []).map(w => w.id === id ? { ...w, ...patch } : w) }
    }))
    get().saveDebounced()
  },
  removeWindow(id) {
    get()._pushHistory()
    set(s => ({ plan: { ...s.plan, windows: (s.plan.windows || []).filter(w => w.id !== id) } }))
    get().save()
  },
  addSpace(space) {
    get()._pushHistory()
    const sp = { id: newSpaceId(), color: '#e2e8f0', height: 280, ...space }
    set(s => ({ plan: { ...s.plan, spaces: [...(s.plan.spaces || []), sp] } }))
    get().save()
    return sp.id
  },
  updateSpace(id, patch) {
    set(s => ({
      plan: { ...s.plan, spaces: (s.plan.spaces || []).map(sp => sp.id === id ? { ...sp, ...patch } : sp) }
    }))
    get().saveDebounced()
  },
  removeSpace(id) {
    get()._pushHistory()
    set(s => ({ plan: { ...s.plan, spaces: (s.plan.spaces || []).filter(sp => sp.id !== id) } }))
    get().save()
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 撤銷 / 重做
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  _pushHistory() {
    const s = get()
    const snapshot = JSON.stringify(s.plan)
    const stack = s.history.stack.slice(0, s.history.pointer + 1)
    stack.push(snapshot)
    while (stack.length > HISTORY_LIMIT) stack.shift()
    set({ history: { stack, pointer: stack.length - 1 } })
  },
  undo() {
    const s = get()
    if (s.history.pointer <= 0) return
    const newPointer = s.history.pointer - 1
    const snap = JSON.parse(s.history.stack[newPointer])
    set({ plan: snap, history: { ...s.history, pointer: newPointer } })
    get().save()
  },
  redo() {
    const s = get()
    if (s.history.pointer >= s.history.stack.length - 1) return
    const newPointer = s.history.pointer + 1
    const snap = JSON.parse(s.history.stack[newPointer])
    set({ plan: snap, history: { ...s.history, pointer: newPointer } })
    get().save()
  },
  canUndo: () => get().history.pointer > 0,
  canRedo: () => get().history.pointer < get().history.stack.length - 1,

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 多樓層
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /** 首次切到多樓層時,把現在的單樓層資料變成 floors[0] */
  _ensureMultiFloorMode() {
    const s = get()
    if (s.plan.floors?.length >= 1) return  // 已經是多樓層
    const firstId = newId('floor')
    const firstName = s.meta?.floor_label || '樓層 1'
    set(state => ({
      plan: {
        ...state.plan,
        floors: [{ id: firstId, name: firstName }],
        currentFloorId: firstId,
        floorSnapshots: {}
      }
    }))
  },
  addFloor(name) {
    get()._ensureMultiFloorMode()
    const s = get()
    // 把目前資料存入 currentFloorId 的快照
    const curSnap = extractFloorSnapshot(s.plan)
    const newFloorId = newId('floor')
    const floorName = name || `樓層 ${s.plan.floors.length + 1}`
    // 切到新樓層:plan 各欄位變空白 (但保留 metadata)
    const empty = emptyPlan()
    set(state => ({
      plan: {
        ...state.plan,
        ...extractFloorSnapshot(empty),  // 重設樓層欄位為空
        floors: [...state.plan.floors, { id: newFloorId, name: floorName }],
        currentFloorId: newFloorId,
        floorSnapshots: { ...state.plan.floorSnapshots, [s.plan.currentFloorId]: curSnap }
      },
      history: { stack: [], pointer: -1 }  // 切樓層後歷史重置
    }))
    get().save()
  },
  switchFloor(floorId) {
    const s = get()
    if (!s.plan.floors?.length) return
    if (floorId === s.plan.currentFloorId) return
    if (!s.plan.floors.find(f => f.id === floorId)) return
    // 把目前資料存入舊樓層快照
    const curSnap = extractFloorSnapshot(s.plan)
    const targetSnap = s.plan.floorSnapshots[floorId] || extractFloorSnapshot(emptyPlan())
    set(state => ({
      plan: {
        ...state.plan,
        ...targetSnap,
        currentFloorId: floorId,
        floorSnapshots: { ...state.plan.floorSnapshots, [s.plan.currentFloorId]: curSnap }
      },
      history: { stack: [], pointer: -1 }
    }))
    get().save()
  },
  renameFloor(floorId, newName) {
    set(s => ({
      plan: {
        ...s.plan,
        floors: s.plan.floors.map(f => f.id === floorId ? { ...f, name: newName } : f)
      }
    }))
    get().save()
  },
  removeFloor(floorId) {
    const s = get()
    if ((s.plan.floors?.length || 0) <= 1) {
      alert('至少要保留一個樓層')
      return
    }
    const remaining = s.plan.floors.filter(f => f.id !== floorId)
    const snapshots = { ...s.plan.floorSnapshots }
    delete snapshots[floorId]
    // 如果刪的是目前樓層,切到第一個
    if (s.plan.currentFloorId === floorId) {
      const target = remaining[0]
      const targetSnap = snapshots[target.id] || extractFloorSnapshot(emptyPlan())
      delete snapshots[target.id]
      set(state => ({
        plan: {
          ...state.plan,
          ...targetSnap,
          floors: remaining,
          currentFloorId: target.id,
          floorSnapshots: snapshots
        }
      }))
    } else {
      set(state => ({
        plan: { ...state.plan, floors: remaining, floorSnapshots: snapshots }
      }))
    }
    get().save()
  },

  setMeta(patch) {
    set(s => ({ meta: { ...s.meta, ...patch } }))
    get().saveDebounced()
  },

  // 拖拉時連續觸發 update,所以 debounce 一下避免打爆雲端
  _saveTimer: null,
  saveDebounced() {
    clearTimeout(get()._saveTimer)
    const t = setTimeout(() => get().save(), 400)
    set({ _saveTimer: t })
  }
}))
