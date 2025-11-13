import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StudioService } from '../core/services/studio.service';
import { StudioStateService } from '../core/state/studio-state.service';
import { FloorplanRecord } from '../models/floorplan.model';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CoreAuthService, CoreAuthSession } from '@berjis/angular-auth';

type Point = { x: number; y: number };
type Opening = { id: string; kind: 'door'|'window'; offset: number; width: number };
type WallType = 'interior'|'exterior'|'loadbearing'|'partition';
type Wall = {
  id: string;
  a: Point;
  b: Point;
  thickness: number;
  height: number;
  openings: Opening[];
  type: WallType;
  offset: number;
  compositeId?: string;
  compositeT0?: number;
  compositeT1?: number;
};
type Room = { id: string; x: number; y: number; w: number; h: number; height: number };
type WallDragAnchor = { wall: Wall; end: 'a'|'b'; point: Point };
type MeasurementSegment = { id: string; a: Point; b: Point; length: number };
type WallFace = { id: string; corners: [Point, Point, Point, Point]; wallId: string };
type RoomMesh = { id: string; faces: [Point, Point, Point, Point][] };
type ViewportBox = { minX: number; minY: number; width: number; height: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type LightingPreset = 'lit' | 'unlit' | 'wireframe' | 'detail';
type GuideOverlay = { start: Point; end: Point; mode: 'parallel'|'perpendicular' };
type LightingPalette = {
  wallFill: string | null;
  wallEdge: string;
  wallEdgeWidth: number;
  roomFill: string | null;
  roomEdge: string;
  roomEdgeWidth: number;
  measurement: string;
  measurementDraft: string;
};
type CornerAngleLabel = { id: string; cx: number; cy: number; x: number; y: number; text: string; path: string | null };
type CornerJoinOverlay = { id: string; path: string; fill: string; stroke?: string; strokeWidth?: number };
type WallNodeDirection = {
  dir: Point;
  angle: number;
  left: Point;
  right: Point;
  half: number;
  length: number;
  wall: Wall;
  end: 'a'|'b';
};
type StudioSnapshot = { walls: Wall[]; rooms: Room[]; description: string };
type SplitHint = { id: string; t: number; point: Point; offset: number; fromEnd: number };
type CurveComposite = {
  id: string;
  segmentIds: string[];
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
  control: Point;
  closed: boolean;
  samplePoints: Point[];
};
type CurveDraft =
  | { kind: 'create'; stage: 'start'|'control'|'end'; start?: Point; control?: Point }
  | { kind: 'convert'; stage: 'control'; wallId: string; start: Point; end: Point };
type CurvePreview = {
  points: Point[];
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
};

@Component({
  selector: 'arch-design-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './design-studio.page.html'
})
export class DesignStudioPage implements OnInit, OnDestroy {
  @ViewChild('pane') pane?: ElementRef<HTMLDivElement>;
  @ViewChild('canvas3d') canvas3d?: ElementRef<HTMLCanvasElement>;

  // UI state
  toolset: 'project'|'build'|'info'|'objects'|'styleboards'|'finishes'|'exports'|'help' = 'project';
  private _viewPort: '2d'|'3d' = '2d';
  get viewPort(): '2d'|'3d' { return this._viewPort; }
  set viewPort(value: '2d'|'3d') {
    if (this._viewPort === value) {
      return;
    }
    this._viewPort = value;
    if (value === '3d') {
      this.lastFrame = performance.now();
      this.invalidate3dCache();
      this.scheduleFrame();
    } else if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  units: 'm'|'ft' = 'm';
  lockConstruction = false;
  lockLabels = false;
  lockFurniture = false;
  angleSnap = true;
  wallJoinStyle: 'butt'|'miter'|'round' = 'miter';
  readonly defaultViewBox = { minX: -1000, minY: -800, width: 2000, height: 1600 };
  private readonly defaultGridSpacing = 100;
  private readonly defaultGridMajorEvery = 5;
  private readonly defaultGridOpacity = 0.35;

  // Drawing state
  mode: 'select'|'pan'|'wall'|'curve'|'room'|'door'|'window'|'measure' = 'select';
  creating = false;
  lightingPreset: LightingPreset = 'lit';
  // world objects
  walls: Wall[] = [];
  rooms: Room[] = [];
  roomMeshes: RoomMesh[] = [];
  wallFaces: WallFace[] = [];
  // temp preview
  draftA: Point | null = null; // for wall start or room start
  draftB: Point | null = null; // current cursor position in drag
  wallPath: Point[] = [];
  // selection/dragging
  selectedWallId: string | null = null;
  selectedWallIds: string[] = [];
  selectedWallPoint: Point | null = null;
  selectedWallT: number | null = null;
  manualSplitActive = false;
  manualSplitPreview: { wallId: string; point: Point; offset: number; fromEnd: number; t: number } | null = null;
  splitHints: SplitHint[] = [];
  activeSplitHintId: string | null = null;
  curveComposites = new Map<string, CurveComposite>();
  curveDraft: CurveDraft | null = null;
  curvePreview: CurvePreview | null = null;
  roomPath: Point[] = [];
  roomDraftPoint: Point | null = null;
  roomClosePreview = false;
  selectedRoomId: string | null = null;
  dragging: null
    | {
        kind: 'wall-node';
        anchors: WallDragAnchor[];
        start: Point;
        walls: { wall: Wall; originalLength: number }[];
      }
    | {
        kind: 'wall-body';
        walls: { wall: Wall; originalA: Point; originalB: Point }[];
        start: Point;
        delta: Point;
      }
    | {
        kind: 'room-corner';
        roomId: string;
        corner: 'nw'|'ne'|'sw'|'se';
        start: Point;
        originalRect: { x: number; y: number; w: number; h: number };
      } = null;
  private draggingMoved = false;
  draggingMeasurements: MeasurementSegment[] = [];
  draggingDeltaLabel: { position: Point; text: string } | null = null;
  private skipNextClick = false;
  // tool properties
  wallThickness = 200; // mm world units
  wallHeight = 3000;   // mm
  standardThicknesses: number[] = [90, 110, 140, 200, 300];
  standardHeights: number[] = [2400, 2700, 3000, 3300, 3600];
  thicknessAnchor: 'center'|'left'|'right' = 'center';
  pendingThickness: number | null = null;
  thicknessPreviewPaths: { id: string; path: string }[] = [];
  currentWallType: WallType = 'interior';
  wallTypeOptions: WallType[] = ['interior', 'exterior', 'loadbearing', 'partition'];
  wallTypePalette: Record<WallType, { base: string; selected: string; outline: string; outlineSelected: string }> = {
    interior: { base: '#1f2937', selected: '#2563eb', outline: '#0f172a', outlineSelected: '#1d4ed8' },
    exterior: { base: '#475569', selected: '#f97316', outline: '#1f2937', outlineSelected: '#ea580c' },
    loadbearing: { base: '#4d7c0f', selected: '#22c55e', outline: '#365314', outlineSelected: '#16a34a' },
    partition: { base: '#334155', selected: '#a855f7', outline: '#1e293b', outlineSelected: '#9333ea' }
  };
  private undoStack: StudioSnapshot[] = [];
  private redoStack: StudioSnapshot[] = [];
  openingWidth = 900;  // mm
  lengthDelta = 200;
  private readonly wallMinLength = 400;
  private readonly wallMaxLength = 25000;
  private readonly guideThresholdCos = Math.cos(6 * Math.PI / 180);
  private readonly intersectionEpsilon = 0.002;

  // Viewport (world units)
  minX = this.defaultViewBox.minX; minY = this.defaultViewBox.minY;
  width = this.defaultViewBox.width; height = this.defaultViewBox.height;
  scale = 1; // 1 == 1:1 world units
  gridSpacing = this.defaultGridSpacing;
  gridMajorEvery = this.defaultGridMajorEvery;
  gridOpacity = this.defaultGridOpacity;

  private panning = false;
  private panStart = { x: 0, y: 0 };
  private viewStart = { minX: 0, minY: 0 };
  snap = true;
  name = '';
  planId: string | null = null;
  lastSavedAt: Date | null = null;
  saveState: 'idle'|'saving'|'success'|'error' = 'idle';
  statusMessage = '';
  loadingPlan = false;

  private authUnsub?: () => void;
  private userUuid: string | null = null;
  private animationId: number | null = null;
  private lastFrame = 0;
  private cameraPreset: 'perspective'|'front'|'side' = 'perspective';
  private autoOrbit = true;
  private cam = { yaw: 0, pitch: -0.6, distance: 4500 };
  private dirty3d = true;
  private renderCache: ImageData | null = null;
  private renderCacheSize = { width: 0, height: 0 };
  guideOverlay: GuideOverlay | null = null;
  pendingIntersection: Point | null = null;
  private constraintMessage: string | null = null;

  private qpSub?: Subscription;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  measureStart: Point | null = null;
  measureDraft: Point | null = null;
  measurements: MeasurementSegment[] = [];

  private viewportTween: { raf: number | null; start: number; duration: number; from: ViewportBox; to: ViewportBox } | null = null;
  private readonly minViewportDimension = 200;

  title = 'Architect';
  isDark = false;
  ngOnInit(): void {
    this.authUnsub = this.auth.onSessionChange((session: CoreAuthSession) => this.applySession(session));
    void this.auth.ensureAuth({ maxAgeMs: 1500 }).catch(err => console.warn("ensureAuth failed", err));
    const persisted = (localStorage.getItem('theme') || '').toLowerCase();
    const preferDark = persisted === 'dark';
    this.setTheme(preferDark ? 'dark' : 'light');
    this.qpSub = this.route.queryParamMap.subscribe(params => {
      const planParam = params.get('plan');
      if (params.has('new')) {
        this.beginNewPlan();
        void this.updateQuery({ new: null, plan: null });
        return;
      }
      if (planParam) {
        if (planParam !== this.planId) {
          void this.loadPlan(planParam);
        }
      } else if (!this.planId) {
        this.beginNewPlan();
      }
    });
  }

  private applySession(session: CoreAuthSession) {
    if (session && session.valid) {
      const profile = (session.profile || {}) as Record<string, unknown>;
      const candidate =
        session.uuid ||
        (typeof profile['uuid'] === 'string' ? profile['uuid'] : undefined) ||
        (typeof profile['id'] === 'string' ? profile['id'] : undefined);
      this.userUuid = candidate ? String(candidate) : null;
    } else {
      this.userUuid = null;
    }
  }

  ngOnDestroy(): void {
    this.authUnsub?.();
    this.qpSub?.unsubscribe();
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  toggleTheme() { this.setTheme(this.isDark ? 'light' : 'dark'); }
  setWallJoinStyle(style: 'butt'|'miter'|'round'): void {
    if (this.wallJoinStyle === style) {
      return;
    }
    this.wallJoinStyle = style;
    this.invalidate3dCache();
  }
  private setTheme(mode: 'light' | 'dark') {
    this.isDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', mode === 'dark');
    try { localStorage.setItem('theme', mode); } catch {}
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
  }

  viewBox() { return `${this.minX} ${this.minY} ${this.width} ${this.height}`; }
  clearAll(){
    this.walls=[];
    this.rooms=[];
    this.creating=false;
    this.draftA=null;
    this.draftB=null;
    this.wallPath=[];
    this.clearSelection();
    this.dragging=null;
    this.draggingMoved = false;
    this.draggingMeasurements = [];
    this.draggingDeltaLabel = null;
    this.skipNextClick = false;
    this.roomMeshes = [];
    this.wallFaces = [];
    this.currentWallType = 'interior';
    this.thicknessAnchor = 'center';
    this.pendingThickness = null;
    this.thicknessPreviewPaths = [];
    this.invalidate3dCache();
    this.guideOverlay = null;
    this.pendingIntersection = null;
    this.constraintMessage = null;
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
  }
  private clearSelection(): void {
    this.selectedWallIds = [];
    this.selectedWallId = null;
    this.selectedWallPoint = null;
    this.selectedWallT = null;
    this.manualSplitActive = false;
    this.manualSplitPreview = null;
    this.splitHints = [];
    this.activeSplitHintId = null;
    this.selectedRoomId = null;
    this.pendingThickness = null;
    this.thicknessPreviewPaths = [];
  }
  private cancelDraft(): void {
    if (!this.creating) {
      return;
    }
    this.creating = false;
    this.draftA = null;
    this.draftB = null;
    this.wallPath = [];
    this.roomPath = [];
    this.roomDraftPoint = null;
    this.roomClosePreview = false;
    this.guideOverlay = null;
    this.pendingIntersection = null;
  }
  private invalidate3dCache(): void {
    this.dirty3d = true;
    this.renderCache = null;
    this.renderCacheSize = { width: 0, height: 0 };
  }
  private activateModeShortcut(mode: this['mode'], message: string): void {
    if (mode === 'measure') {
      this.toggleMeasureMode(true);
      this.setSaveState('idle', message);
      return;
    }
    if (this.mode === 'measure') {
      this.toggleMeasureMode(false);
    }
    if (this.mode !== mode) {
      this.cancelDraft();
    }
    this.mode = mode;
    if (mode !== 'wall') {
      this.guideOverlay = null;
    }
    this.setSaveState('idle', message);
  }
  private setCameraPreset(preset: 'perspective'|'front'|'side', sourceLabel?: string): void {
    const previousView = this.viewPort;
    this.cameraPreset = preset;
    if (preset === 'perspective') {
      this.autoOrbit = true;
      this.cam.pitch = -0.6;
      this.cam.yaw = Math.PI / 4;
      this.cam.distance = Math.max(this.cam.distance, 4500);
    } else {
      this.autoOrbit = false;
      this.cam.pitch = -0.1;
      this.cam.distance = Math.max(this.cam.distance, 3500);
      this.cam.yaw = preset === 'front' ? Math.PI / 2 : 0;
    }
    this.lastFrame = performance.now();
    this.invalidate3dCache();
    if (this.viewPort !== '3d') {
      this.viewPort = '3d';
    } else if (previousView === '3d') {
      this.scheduleFrame();
    }
    const label = `${this.describeCameraPreset()}${sourceLabel ? ` (${sourceLabel})` : ''}.`;
    this.setSaveState('idle', label);
  }
  private describeCameraPreset(): string {
    switch (this.cameraPreset) {
      case 'front':
        return 'Front elevation view';
      case 'side':
        return 'Side elevation view';
      default:
        return 'Perspective orbit view';
    }
  }
  private setLightingPreset(preset: LightingPreset, sourceLabel?: string): void {
    if (this.lightingPreset === preset) {
      const description = this.describeLightingPreset(preset);
      this.setSaveState('idle', `${description}${sourceLabel ? ` (${sourceLabel})` : ''}.`);
      return;
    }
    this.lightingPreset = preset;
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
    const description = this.describeLightingPreset(preset);
    this.setSaveState('idle', `${description}${sourceLabel ? ` (${sourceLabel})` : ''}.`);
  }
  private describeLightingPreset(preset: LightingPreset): string {
    switch (preset) {
      case 'lit':
        return 'Lit shading preset';
      case 'unlit':
        return 'Unlit preview preset';
      case 'wireframe':
        return 'Wireframe preview preset';
      case 'detail':
        return 'Detailed shading preset';
      default:
        return 'Lighting preset';
    }
  }

  // Pointer events
  onSvgClick(e: MouseEvent){
    if (this.skipNextClick) {
      this.skipNextClick = false;
      return;
    }
    if (this.mode !== 'curve' && this.curveDraft) {
      this.curveDraft = null;
      this.curvePreview = null;
    }
    const raw = this.toWorld(e);
    if (this.manualSplitActive && this.mode === 'select') {
      const wall = this.selectedWall;
      if (!wall) {
        this.manualSplitActive = false;
        this.manualSplitPreview = null;
        this.splitHints = [];
        this.activeSplitHintId = null;
        this.refreshSplitHints();
        this.setSaveState('idle', 'Split cancelled.');
        return;
      }
      const point = this.resolveGenericPoint(raw);
      const { dist, t } = this.pointSegDistanceParam(point, wall.a, wall.b);
      const tolerance = this.manualSplitTolerance(wall);
      if (dist <= tolerance) {
        const snappedT = this.snapManualSplitParam(wall, t);
        if (snappedT <= this.intersectionEpsilon || snappedT >= 1 - this.intersectionEpsilon) {
          this.setSaveState('idle', 'Choose a point away from the wall ends.');
        } else if (this.wallHasNodeAtParam(wall, snappedT)) {
          this.setSaveState('idle', 'Existing junction selected. No split created.');
        } else {
          const snapshot = this.createSnapshot('manual wall split');
          this.selectedWallT = snappedT;
          this.updateSelectedWallPoint();
          const result = this.ensureNodeAtSelection();
          if (result?.created) {
            this.undoStack.push(snapshot);
            if (this.undoStack.length > 50) {
              this.undoStack.shift();
            }
            this.redoStack = [];
            const length = this.segLen(wall.a, wall.b);
            const offset = snappedT * length;
            this.setSaveState('success', `Wall split at ${this.formatLength(offset)}.`);
            this.invalidate3dCache();
            if (this.viewPort === '3d') {
              this.scheduleFrame();
            }
          } else {
            this.setSaveState('idle', 'Existing junction selected. No split created.');
          }
        }
      } else {
        this.setSaveState('idle', 'Split cancelled.');
      }
      this.manualSplitActive = false;
      this.manualSplitPreview = null;
      this.splitHints = [];
      this.activeSplitHintId = null;
      this.refreshSplitHints();
      return;
    }
    if (this.mode === 'curve') {
      const point = this.resolveGenericPoint(raw);
      this.handleCurveClick(point);
      return;
    }
    if (this.mode !== 'wall') {
      this.guideOverlay = null;
      this.pendingIntersection = null;
    }
    if(this.mode==='measure'){
      const point = this.resolveGenericPoint(raw);
      if(!this.measureStart){
        this.measureStart = { ...point };
        this.measureDraft = { ...point };
        this.setSaveState('idle', 'Select a second point to measure distance.');
        this.invalidate3dCache();
      } else {
        if(!this.samePoint(this.measureStart, point)){
          const length = this.segLen(this.measureStart, point);
          this.measurements = [
            ...this.measurements,
            { id: this.uid(), a: { ...this.measureStart }, b: { ...point }, length }
          ];
          this.setSaveState('success', `Measured ${this.formatLength(length)}.`);
        }
        this.measureStart = null;
        this.measureDraft = null;
        this.invalidate3dCache();
      }
      if (this.viewPort === '3d') {
        this.scheduleFrame();
      }
      return;
    }
    if(this.mode==='select'){
      const p = this.resolveGenericPoint(raw);
      const roomHit = this.pickRoomAtPoint(p);
      if (roomHit) {
        this.selectedRoomId = roomHit.id;
        this.selectedWallIds = [];
        this.selectedWallId = null;
        this.selectedWallPoint = null;
        this.selectedWallT = null;
        this.setSaveState(
          'idle',
          `Room ${this.formatLength(roomHit.w)} × ${this.formatLength(roomHit.h)} selected.`
        );
        this.focusSelection('pan');
        return;
      }
      const hit = this.pickWallAtPoint(p, 30);
      if(hit){
        const wallId = hit.wall.id;
        const multiKey = e.ctrlKey || e.metaKey;
        const rangeKey = e.shiftKey;
        let nextIds = [...this.selectedWallIds];
        if (rangeKey && this.selectedWallIds.length > 0 && this.selectedWallId) {
          const fromIndex = this.walls.findIndex(w => w.id === this.selectedWallId);
          const toIndex = this.walls.findIndex(w => w.id === wallId);
          if (fromIndex !== -1 && toIndex !== -1) {
            const start = Math.min(fromIndex, toIndex);
            const end = Math.max(fromIndex, toIndex);
            const rangeIds = this.walls.slice(start, end + 1).map(w => w.id);
            nextIds = Array.from(new Set([...nextIds, ...rangeIds]));
          } else {
            nextIds = Array.from(new Set([...nextIds, wallId]));
          }
        } else if (multiKey) {
          if (nextIds.includes(wallId)) {
            nextIds = nextIds.filter(id => id !== wallId);
          } else {
            nextIds = [...nextIds, wallId];
          }
        } else {
          nextIds = [wallId];
        }
        if (nextIds.length === 0) {
          this.clearSelection();
          this.setSaveState('idle', 'Selection cleared.');
          return;
        }
        this.selectedRoomId = null;
        this.selectedWallIds = nextIds;
        this.includeCompositeMembers(wallId);
        this.selectedWallT = hit.t;
        this.syncPrimarySelection(wallId);
        const primaryWall = this.selectedWall;
        if (this.selectedWallIds.length > 1) {
          const total = this.totalSelectedWallLength;
          this.setSaveState('idle', `${this.selectedWallIds.length} walls selected (${this.formatLength(total)} total).`);
        } else if (primaryWall) {
          this.setSaveState('idle', `Wall length: ${this.formatLength(this.segLen(primaryWall.a, primaryWall.b))}`);
        }
        this.focusSelection('pan');
      } else {
        this.clearSelection();
        this.setSaveState('idle', 'Select a wall or room, or switch tools to keep drafting.');
      }
      return;
    }
    if(this.mode==='wall'){
      const p = this.resolveWallPoint(raw);
      if(!this.creating){
        const start = { ...p };
        this.creating = true;
        this.wallPath = [start];
        this.draftA = start;
        this.draftB = start;
        this.pendingIntersection = null;
        this.clearConstraintMessage();
      } else {
        this.addWallSegment(p);
      }
      return;
    }
    if(this.mode==='room'){
      const point = this.resolveGenericPoint(raw);
      if(!this.creating){
        this.creating = true;
        this.roomPath = [{ ...point }];
        this.roomDraftPoint = { ...point };
        this.roomClosePreview = false;
        this.setSaveState('idle', 'Room tool: add corners, click start point or press Enter to close.');
      } else {
        const first = this.roomPath[0];
        const closeToFirst = this.roomPath.length >= 2 && this.dist(point, first) <= this.roomCloseTolerance();
        if (closeToFirst) {
          this.finalizeRoomDraft(false);
        } else {
          const last = this.roomPath[this.roomPath.length - 1];
          if (!this.samePoint(last, point)) {
            this.roomPath.push({ ...point });
            this.roomDraftPoint = { ...point };
            this.roomClosePreview = false;
          }
        }
      }
      return;
    }
    // placing doors/windows with single click
    if(this.mode==='door' || this.mode==='window'){
      const p = this.resolveGenericPoint(raw);
      const hit = this.pickWallAtPoint(p, 30);
      if(hit){
        const { wall, t } = hit; // 0..1 along wall
        const length = this.segLen(wall.a, wall.b);
        const offset = t * length;
        wall.openings.push({ id: this.uid(), kind: this.mode, offset, width: this.openingWidth });
      }
      return;
    }
  }
  onSvgDoubleClick(e: MouseEvent){
    if(this.mode==='wall' && this.creating){
      e.preventDefault();
      e.stopPropagation();
      this.finishWallDrawing();
    }
  }
  onMouseDown(e: MouseEvent){
    // handle pan first
    if(this.mode==='pan'){
      this.panning = true; this.panStart = { x: e.clientX, y: e.clientY }; this.viewStart = { minX: this.minX, minY: this.minY }; return;
    }
    if (this.mode === 'curve') {
      return;
    }
    const p = this.resolveGenericPoint(this.toWorld(e));
    // if select, attempt to start dragging handle
    if(this.mode==='select'){
      const h = this.hitHandle(p);
      if(h){
        if (h.kind === 'wall-node') {
          const seen = new Set<string>();
          const walls: { wall: Wall; originalLength: number }[] = [];
          h.anchors.forEach(anchor => {
            if (!seen.has(anchor.wall.id)) {
              seen.add(anchor.wall.id);
              walls.push({ wall: anchor.wall, originalLength: this.segLen(anchor.wall.a, anchor.wall.b) });
            }
          });
          this.dragging = { kind: 'wall-node', anchors: h.anchors, start: { ...p }, walls };
        } else {
          const room = this.rooms.find(r => r.id === h.roomId);
          if (!room) {
            return;
          }
          this.dragging = {
            kind: 'room-corner',
            roomId: h.roomId,
            corner: h.corner,
            start: { ...p },
            originalRect: { x: room.x, y: room.y, w: room.w, h: room.h }
          };
        }
        this.draggingMoved = false;
        this.updateDragMeasurements();
        return;
      }
      const wallHit = this.pickWallAtPoint(p, 30);
      if (wallHit) {
        const wallId = wallHit.wall.id;
        const multiKey = e.ctrlKey || e.metaKey;
        const rangeKey = e.shiftKey;
        let nextIds = [...this.selectedWallIds];
        if (!nextIds.length) {
          nextIds = [wallHit.wall.id];
        } else if (rangeKey && this.selectedWallId) {
          const fromIndex = this.walls.findIndex(w => w.id === this.selectedWallId);
          const toIndex = this.walls.findIndex(w => w.id === wallHit.wall.id);
          if (fromIndex !== -1 && toIndex !== -1) {
            const start = Math.min(fromIndex, toIndex);
            const end = Math.max(fromIndex, toIndex);
            const rangeIds = this.walls.slice(start, end + 1).map(w => w.id);
            nextIds = Array.from(new Set([...nextIds, ...rangeIds]));
          } else if (!nextIds.includes(wallHit.wall.id)) {
            nextIds.push(wallHit.wall.id);
          }
        } else if (multiKey) {
          if (!nextIds.includes(wallHit.wall.id)) {
            nextIds.push(wallHit.wall.id);
          }
        } else if (!nextIds.includes(wallHit.wall.id)) {
          nextIds = [wallHit.wall.id];
        }
        this.selectedRoomId = null;
        this.selectedWallIds = nextIds;
        this.includeCompositeMembers(wallId);
        this.selectedWallT = wallHit.t;
        this.syncPrimarySelection(wallHit.wall.id);
        const targetIds = this.selectedWallIds.includes(wallHit.wall.id)
          ? this.selectedWallIds
          : [wallHit.wall.id];
        const dragWalls = targetIds
          .map(id => this.walls.find(w => w.id === id))
          .filter((w): w is Wall => Boolean(w))
          .map(wall => ({
            wall,
            originalA: { x: wall.a.x, y: wall.a.y },
            originalB: { x: wall.b.x, y: wall.b.y }
          }));
        this.dragging = {
          kind: 'wall-body',
          walls: dragWalls,
          start: { ...p },
          delta: { x: 0, y: 0 }
        };
        this.draggingMoved = false;
        this.updateDragMeasurements();
        return;
      }
    }
  }
  onMouseMove(e: MouseEvent){
    if(this.panning){
      const el = this.paneElement();
      if(!el){ return; }
      const dx = e.clientX - this.panStart.x;
      const dy = e.clientY - this.panStart.y;
      const pxToWorldX = this.width / el.clientWidth;
      const pxToWorldY = this.height / el.clientHeight;
      this.minX = this.viewStart.minX - dx * pxToWorldX;
      this.minY = this.viewStart.minY - dy * pxToWorldY;
      return;
    }
    const raw = this.toWorld(e);
    if (this.mode !== 'curve' && this.curveDraft) {
      this.curveDraft = null;
      this.curvePreview = null;
    }
    if(this.mode==='measure'){
      if(this.measureStart){
        this.measureDraft = this.resolveGenericPoint(raw);
        this.invalidate3dCache();
        if (this.viewPort === '3d') {
          this.scheduleFrame();
        }
      }
      return;
    }
    if (this.mode === 'curve') {
      const point = this.resolveGenericPoint(raw);
      this.updateCurvePreview(point);
      return;
    }
    if(this.creating){
      if(this.mode==='wall'){
        this.draftB = this.resolveWallPoint(raw);
        return;
      }
      if(this.mode==='room'){
        const p = this.resolveGenericPoint(raw);
        this.updateRoomDraftPreview(p);
        return;
      }
    }
    if (this.mode !== 'wall') {
      this.guideOverlay = null;
      this.pendingIntersection = null;
    }
    const p = this.resolveGenericPoint(raw);
    // dragging handles
    if(this.dragging){
      if(this.dragging.kind==='wall-node'){
        this.dragging.anchors.forEach(anchor=>{
          anchor.point.x = p.x;
          anchor.point.y = p.y;
          anchor.wall[anchor.end] = anchor.point;
        });
        this.draggingMoved = true;
        this.skipNextClick = true;
        this.updateSelectedWallPoint();
        this.updateDragMeasurements();
      } else if (this.dragging.kind === 'wall-body') {
        const drag = this.dragging;
        const delta = this.computeBodyDragDelta(drag, p);
        drag.delta = { x: delta.dx, y: delta.dy };
        drag.walls.forEach(entry => {
          entry.wall.a = { x: entry.originalA.x + delta.dx, y: entry.originalA.y + delta.dy };
          entry.wall.b = { x: entry.originalB.x + delta.dx, y: entry.originalB.y + delta.dy };
        });
        const moved = Math.abs(delta.dx) > 0.01 || Math.abs(delta.dy) > 0.01;
        this.draggingMoved = moved;
        if (moved) {
          this.skipNextClick = true;
        }
        this.updateSelectedWallPoint();
        this.updateDragMeasurements();
        this.pendingIntersection = null;
        this.guideOverlay = null;
        this.invalidate3dCache();
        if (this.viewPort === '3d') {
          this.scheduleFrame();
        }
      } else if(this.dragging.kind==='room-corner'){
        const d = this.dragging;
        const r = this.rooms.find(x=>x.id===d.roomId)!;
        const x2 = (d.corner==='ne' || d.corner==='se') ? p.x : r.x;
        const y2 = (d.corner==='sw' || d.corner==='se') ? p.y : r.y;
        const x1 = (d.corner==='ne' || d.corner==='se') ? r.x : p.x;
        const y1 = (d.corner==='sw' || d.corner==='se') ? r.y : p.y;
        r.x = Math.min(x1,x2); r.y = Math.min(y1,y2); r.w = Math.abs(x2-x1); r.h = Math.abs(y2-y1);
        this.updateDragMeasurements();
        this.draggingMoved = true;
        this.skipNextClick = true;
      }
      return;
    }
    if (this.manualSplitActive && this.mode === 'select') {
      const wall = this.selectedWall;
      if (wall) {
        const { dist, t } = this.pointSegDistanceParam(p, wall.a, wall.b);
        const tolerance = this.manualSplitTolerance(wall);
        if (dist <= tolerance) {
          const snappedT = this.snapManualSplitParam(wall, t);
          const clamped = Math.max(0, Math.min(1, snappedT));
          const point = {
            x: wall.a.x + (wall.b.x - wall.a.x) * clamped,
            y: wall.a.y + (wall.b.y - wall.a.y) * clamped
          };
          const length = this.segLen(wall.a, wall.b);
          const offset = clamped * length;
          this.manualSplitPreview = {
            wallId: wall.id,
            point,
            offset,
            fromEnd: length - offset,
            t: clamped
          };
          this.updateActiveSplitHint(clamped);
        } else {
          this.manualSplitPreview = null;
          this.activeSplitHintId = null;
        }
      } else {
        this.manualSplitPreview = null;
        this.activeSplitHintId = null;
      }
    } else if (!this.manualSplitActive) {
      this.manualSplitPreview = null;
      this.activeSplitHintId = null;
    }
  }
  onMouseUp(){
    if(this.panning){ this.panning = false; }
    this.finishDragGesture();
  }
  @HostListener('window:mouseup') winUp(){
    if(this.panning){ this.panning=false; }
    this.finishDragGesture();
  }
  @HostListener('window:keydown.escape') cancelGesture(){
    if(this.mode==='measure'){
      if(this.measureStart){
        this.measureStart = null;
        this.measureDraft = null;
        this.setSaveState('idle', 'Measurement cancelled.');
      } else {
        this.toggleMeasureMode(false);
      }
      this.invalidate3dCache();
      this.dragging = null;
      this.draggingMoved = false;
      this.draggingMeasurements = [];
      this.draggingDeltaLabel = null;
      this.skipNextClick = false;
      return;
    }
    if (this.mode === 'curve' && this.curveDraft) {
      this.resetCurveDraft('select');
      this.setSaveState('idle', 'Curve cancelled.');
      return;
    }
    if (this.manualSplitActive) {
      this.manualSplitActive = false;
      this.manualSplitPreview = null;
      this.splitHints = [];
      this.activeSplitHintId = null;
      this.setSaveState('idle', 'Split cancelled.');
      return;
    }
    if (this.dragging) {
      if (this.dragging.kind === 'wall-body') {
        this.dragging.walls.forEach(entry => {
          entry.wall.a = { ...entry.originalA };
          entry.wall.b = { ...entry.originalB };
        });
        this.invalidate3dCache();
        if (this.viewPort === '3d') {
          this.scheduleFrame();
        }
      }
      this.dragging = null;
      this.draggingMoved = false;
      this.draggingMeasurements = [];
      this.draggingDeltaLabel = null;
      this.skipNextClick = false;
    }
    if(this.creating){
      if(this.mode==='wall'){ this.finishWallDrawing(); }
      else if(this.mode==='room'){
        this.creating=false;
        this.roomPath=[];
        this.roomDraftPoint=null;
        this.roomClosePreview = false;
        this.draftA=null;
        this.draftB=null;
        this.setSaveState('idle', 'Room drafting cancelled.');
      }
    }
    if (this.mode !== 'wall') {
      this.guideOverlay = null;
    }
  }

  private finishDragGesture(): void {
    const drag = this.dragging;
    const moved = this.draggingMoved;
    this.dragging = null;
    this.draggingMoved = false;
    this.draggingMeasurements = [];
    this.draggingDeltaLabel = null;
    this.skipNextClick = moved;
    if (!drag) {
      return;
    }
    if (drag.kind === 'wall-node') {
      if (!moved) {
        return;
      }
      const impactedWalls = drag.anchors.map(anchor => anchor.wall);
      this.reconcileWallGeometry(impactedWalls);
      return;
    }
    if (drag.kind === 'wall-body') {
      if (!moved) {
        drag.walls.forEach(entry => {
          entry.wall.a = { ...entry.originalA };
          entry.wall.b = { ...entry.originalB };
        });
        this.updateSelectedWallPoint();
        this.pendingIntersection = null;
        this.guideOverlay = null;
        this.invalidate3dCache();
        if (this.viewPort === '3d') {
          this.scheduleFrame();
        }
        return;
      }
      const impactedWalls = drag.walls.map(entry => entry.wall);
      this.reconcileWallGeometry(impactedWalls);
      this.updateSelectedWallPoint();
      return;
    }
    if (drag.kind === 'room-corner') {
      if (moved) {
        this.rebuildMeshes();
        this.invalidate3dCache();
        if (this.viewPort === '3d') {
          this.scheduleFrame();
        }
      }
    }
  }
  @HostListener('window:keydown', ['$event'])
  handleGlobalShortcut(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    const key = event.key.toLowerCase();
    const target = event.target as HTMLElement | null;
    const isEditableTarget =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (!event.altKey && isEditableTarget) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        this.redoLastAction();
      } else {
        this.undoLastAction();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'y') {
      event.preventDefault();
      this.redoLastAction();
      return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && (key === 'delete' || key === 'backspace')) {
      event.preventDefault();
      this.deleteSelectedWall();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (['1', '2', '3', '4'].includes(key)) {
        event.preventDefault();
        const preset: Record<string, LightingPreset> = {
          '1': 'lit',
          '2': 'unlit',
          '3': 'wireframe',
          '4': 'detail'
        };
        const sourceLabel = `Alt+${event.key.toUpperCase()}`;
        this.setLightingPreset(preset[key], sourceLabel);
        return;
      }
      if (key === 'g') {
        event.preventDefault();
        this.setCameraPreset('perspective', 'Alt+G');
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        this.viewPort = '2d';
        this.cameraPreset = 'perspective';
        this.autoOrbit = true;
        this.cam.pitch = -0.6;
        this.cam.yaw = Math.PI / 4;
        this.setSaveState('idle', 'Top view (Alt+J).');
        return;
      }
      if (key === 'h') {
        event.preventDefault();
        this.setCameraPreset('front', 'Alt+H');
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        this.setCameraPreset('side', 'Alt+K');
        return;
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    switch (key) {
      case 'q':
        event.preventDefault();
        this.activateModeShortcut('select', 'Selection tool (Q).');
        break;
      case 'w':
        event.preventDefault();
        this.activateModeShortcut('pan', 'Pan / move viewport (W).');
        break;
      case 'e':
        event.preventDefault();
        this.activateModeShortcut('wall', 'Wall tool (E).');
        break;
      case 'r':
        event.preventDefault();
        this.activateModeShortcut('room', 'Room tool (R).');
        break;
      case 'enter':
        if (this.mode === 'room' && this.creating && this.roomPath.length >= 2) {
          event.preventDefault();
          this.finalizeRoomDraft(true);
        }
        break;
      default:
        break;
    }
  }
  onWheel(e: WheelEvent){ e.preventDefault(); const factor = e.deltaY < 0 ? 1/1.1 : 1.1; this.zoom(factor); }
  zoom(f: number){
    if (f <= 0) {
      return;
    }
    this.cancelViewportAnimation();
    const cx = this.minX + this.width / 2;
    const cy = this.minY + this.height / 2;
    const width = this.width * f;
    const height = this.height * f;
    this.applyViewport({
      minX: cx - width / 2,
      minY: cy - height / 2,
      width,
      height
    });
  }
  resetView(){
    this.animateViewport({
      minX: this.defaultViewBox.minX,
      minY: this.defaultViewBox.minY,
      width: this.defaultViewBox.width,
      height: this.defaultViewBox.height
    }, 300);
  }
  fitToContent(): void {
    const bounds = this.contentBounds();
    if (!bounds) {
      this.resetView();
      return;
    }
    const padding = Math.max(this.gridSpacing * 2, 200);
    const minSize = Math.max(this.minViewportDimension, 400);
    const target = this.expandBounds(bounds, padding, minSize);
    this.animateViewport(target, 360);
  }

  updateGridSpacing(value: number | string): void {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      this.gridSpacing = this.clamp(Math.round(numeric), 20, 2000);
    }
  }
  onGridSpacingInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.updateGridSpacing(target?.value ?? this.gridSpacing);
  }

  updateGridMajorEvery(value: number | string): void {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      this.gridMajorEvery = this.clamp(Math.round(numeric), 1, 20);
    }
  }
  onGridMajorEveryInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.updateGridMajorEvery(target?.value ?? this.gridMajorEvery);
  }

  updateGridOpacity(value: number | string): void {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      this.gridOpacity = this.clamp(numeric, 0.05, 1);
    }
  }
  onGridOpacityInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.updateGridOpacity(target?.value ?? this.gridOpacity);
  }

  get gridMajorSpacing(): number {
    return Math.max(this.gridSpacing * this.gridMajorEvery, this.gridSpacing);
  }

  get minorGridPath(): string {
    const g = this.gridSpacing;
    return `M ${g} 0 L 0 0 0 ${g}`;
  }

  get majorGridPath(): string {
    const g = this.gridMajorSpacing;
    return `M ${g} 0 L 0 0 0 ${g}`;
  }

  get minorGridStrokeWidth(): number {
    return Math.max(0.5, this.gridSpacing / 120);
  }

  get majorGridStrokeWidth(): number {
    return Math.max(0.75, this.minorGridStrokeWidth * 1.5);
  }

  get minorGridOpacity(): number {
    return this.clamp(this.gridOpacity, 0, 1);
  }

  get majorGridOpacity(): number {
    return this.clamp(this.gridOpacity * 1.5, 0, 1);
  }

  private clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  private resetGridSettings(): void {
    this.gridSpacing = this.defaultGridSpacing;
    this.gridMajorEvery = this.defaultGridMajorEvery;
    this.gridOpacity = this.defaultGridOpacity;
  }
  get lodDetail(): 'high'|'medium'|'low' {
    const zoom = this.scale;
    if (zoom >= 0.75) {
      return 'high';
    }
    if (zoom >= 0.35) {
      return 'medium';
    }
    return 'low';
  }
  get showWallOpenings(): boolean {
    return this.lodDetail !== 'low';
  }
  get showWallHandles(): boolean {
    return this.lodDetail !== 'low';
  }
  wallFillColor(w: Wall): string {
    const palette = this.wallTypePalette[w.type ?? 'interior'];
    if (!this.selectedWallIds.includes(w.id)) {
      return palette.base;
    }
    return this.selectedWallId === w.id ? palette.selected : palette.outlineSelected;
  }
  wallOutlineStrokeColor(w: Wall): string {
    const palette = this.wallTypePalette[w.type ?? 'interior'];
    if (!this.selectedWallIds.includes(w.id)) {
      return palette.outline;
    }
    return this.selectedWallId === w.id ? palette.outlineSelected : palette.selected;
  }
  wallOutlineStrokeWidth(): number {
    if (this.lodDetail === 'high') {
      return 4;
    }
    if (this.lodDetail === 'medium') {
      return 3;
    }
    return 2;
  }
  private announceConstraint(message: string, severity: 'warning'|'error'): void {
    if (this.constraintMessage === message) {
      return;
    }
    this.constraintMessage = message;
    if (severity === 'error') {
      this.setSaveState('error', message);
    } else {
      this.setSaveState('idle', message);
    }
  }
  private clearConstraintMessage(): void {
    if (this.constraintMessage === null) {
      return;
    }
    this.constraintMessage = null;
  }

  private finishWallDrawing(): void {
    this.rebuildMeshes();
    this.creating = false;
    this.draftA = null;
    this.draftB = null;
    this.wallPath = [];
    this.guideOverlay = null;
  }

  private roomCloseTolerance(): number {
    return Math.max(36, this.gridSpacing * 0.6);
  }

  private updateRoomDraftPreview(point: Point): void {
    if (!this.creating || this.mode !== 'room') {
      return;
    }
    this.roomDraftPoint = { ...point };
    if (this.roomPath.length >= 2) {
      const first = this.roomPath[0];
      this.roomClosePreview = this.dist(first, point) <= this.roomCloseTolerance();
    } else {
      this.roomClosePreview = false;
    }
  }

  roomDraftPathString(): string {
    if (!this.creating || this.mode !== 'room') {
      return '';
    }
    const vertices = this.roomDraftVerticesForDisplay();
    if (vertices.length < 2) {
      return '';
    }
    const commands = [`M ${vertices[0].x} ${vertices[0].y}`];
    for (let i = 1; i < vertices.length; i++) {
      commands.push(`L ${vertices[i].x} ${vertices[i].y}`);
    }
    return commands.join(' ');
  }

  roomDraftVerticesForDisplay(): Point[] {
    const vertices = this.roomPath.map(point => ({ ...point }));
    if (this.roomDraftPoint && (!vertices.length || !this.samePoint(vertices[vertices.length - 1], this.roomDraftPoint))) {
      vertices.push({ ...this.roomDraftPoint });
    }
    return vertices;
  }

  roomDraftLabel(): { point: Point; area: string } | null {
    if (!this.creating || this.mode !== 'room') {
      return null;
    }
    const vertices = this.roomDraftVerticesForDisplay();
    if (vertices.length < 3) {
      return null;
    }
    const footprint = [...vertices];
    if (!this.samePoint(footprint[0], footprint[footprint.length - 1])) {
      footprint.push({ ...footprint[0] });
    }
    const simple = footprint.slice(0, footprint.length - 1);
    const areaMm2 = Math.abs(this.polygonArea(simple));
    if (!Number.isFinite(areaMm2) || areaMm2 <= 1) {
      return null;
    }
    const centroid = this.polygonCentroid(simple);
    return { point: centroid, area: this.formatArea(areaMm2) };
  }

  private finalizeRoomDraft(forceCloseWithPreview: boolean): void {
    if (!this.creating || this.mode !== 'room') {
      return;
    }
    if (this.roomPath.length < 2) {
      this.setSaveState('idle', 'Add at least two corners before closing the room.');
      return;
    }
    let points = this.roomPath.map(point => ({ ...point }));
    if (forceCloseWithPreview && this.roomDraftPoint) {
      const last = points[points.length - 1];
      if (!this.samePoint(last, this.roomDraftPoint)) {
        points.push({ ...this.roomDraftPoint });
      }
    }
    if (points.length < 3) {
      this.setSaveState('idle', 'Add another corner to create a room.');
      return;
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (!this.samePoint(first, last)) {
      points.push({ ...first });
    }
    const footprint = points.slice(0, points.length - 1);
    const areaMm2 = Math.abs(this.polygonArea(footprint));
    this.pushUndoState('room create');
    const newWallIds: string[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (this.samePoint(a, b)) {
        continue;
      }
      const base: Wall = {
        id: this.uid(),
        a: { ...a },
        b: { ...b },
        thickness: this.wallThickness,
        height: this.wallHeight,
        openings: [],
        type: this.currentWallType,
        offset: 0
      };
      const segments = this.splitAgainstAllWalls(base);
      if (segments.length) {
        segments.forEach(segment => newWallIds.push(segment.id));
        this.walls.push(...segments);
      }
    }
    if (newWallIds.length) {
      this.mergeNearbyNodes();
      this.rebuildMeshes();
      this.invalidate3dCache();
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    footprint.forEach(point => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
    const roomId = this.uid();
    this.rooms.push({
      id: roomId,
      x: minX,
      y: minY,
      w: Math.max(0, maxX - minX),
      h: Math.max(0, maxY - minY),
      height: 3000
    });
    this.creating = false;
    this.roomPath = [];
    this.roomDraftPoint = null;
    this.roomClosePreview = false;
    this.draftA = null;
    this.draftB = null;
    const areaLabel = this.formatArea(areaMm2);
    this.setSaveState('success', `Room created (${areaLabel}).`);
  }

  private addWallSegment(target: Point): void {
    if(!this.draftA){ return; }
    const resolved = this.resolveWallPoint(target);
    if(this.samePoint(this.draftA, resolved)){ return; }
    const base: Wall = {
      id: this.uid(),
      a: this.draftA,
      b: resolved,
      thickness: this.wallThickness,
      height: this.wallHeight,
      openings: [],
      type: this.currentWallType,
      offset: 0
    };
    const newSegs = this.splitAgainstAllWalls(base);
    if(newSegs.length === 0){ return; }
    this.walls.push(...newSegs);
    this.mergeNearbyNodes();
    const tail = newSegs[newSegs.length-1].b;
    this.wallPath.push(tail);
    this.draftA = tail;
    this.draftB = tail;
    this.pendingIntersection = null;
    this.guideOverlay = null;
    this.clearConstraintMessage();
    this.rebuildMeshes();
  }

  private paneElement(): HTMLDivElement | null {
    return this.pane?.nativeElement ?? null;
  }
  private toWorld(e: MouseEvent): Point {
    const el = this.paneElement();
    if(!el){
      return { x: 0, y: 0 };
    }
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = this.minX + (px / rect.width) * this.width;
    const y = this.minY + (py / rect.height) * this.height;
    return { x: Math.round(x), y: Math.round(y) };
  }
  private snapPoint(p: Point): Point {
    const spacing = this.gridSpacing || this.defaultGridSpacing;
    return {
      x: Math.round(p.x / spacing) * spacing,
      y: Math.round(p.y / spacing) * spacing
    };
  }
  private applyDirectionalGuides(origin: Point, candidate: Point): { point: Point; guide: GuideOverlay | null } {
    if (this.walls.length === 0) {
      return { point: candidate, guide: null };
    }
    const baseVec = { x: candidate.x - origin.x, y: candidate.y - origin.y };
    const baseLen = Math.hypot(baseVec.x, baseVec.y);
    if (baseLen < 1) {
      return { point: candidate, guide: null };
    }
    const vecNorm = { x: baseVec.x / baseLen, y: baseVec.y / baseLen };
    let best: { mode: 'parallel'|'perpendicular'; dir: { x: number; y: number }; score: number; scalar: number } | null = null;
    for (const wall of this.walls) {
      const dir = this.unitVector(wall.a, wall.b);
      const parallelDot = Math.abs(vecNorm.x * dir.x + vecNorm.y * dir.y);
      if (parallelDot >= this.guideThresholdCos) {
        const scalar = baseVec.x * dir.x + baseVec.y * dir.y;
        if (!best || parallelDot > best.score) {
          best = { mode: 'parallel', dir, score: parallelDot, scalar };
        }
      }
      const perp = { x: -dir.y, y: dir.x };
      const perpDot = Math.abs(vecNorm.x * perp.x + vecNorm.y * perp.y);
      if (perpDot >= this.guideThresholdCos) {
        const scalar = baseVec.x * perp.x + baseVec.y * perp.y;
        if (!best || perpDot > best.score) {
          best = { mode: 'perpendicular', dir: perp, score: perpDot, scalar };
        }
      }
    }
    if (!best) {
      return { point: candidate, guide: null };
    }
    const snapped = {
      x: origin.x + best.dir.x * best.scalar,
      y: origin.y + best.dir.y * best.scalar
    };
    return {
      point: snapped,
      guide: { start: origin, end: snapped, mode: best.mode }
    };
  }
  private currentViewBounds(padding = 0): Bounds {
    const pad = Math.max(0, padding);
    return {
      minX: this.minX - pad,
      minY: this.minY - pad,
      maxX: this.minX + this.width + pad,
      maxY: this.minY + this.height + pad
    };
  }
  private wallBounds(w: Wall): Bounds {
    const half = Math.max(80, w.thickness / 2 + 40);
    const minX = Math.min(w.a.x, w.b.x) - half;
    const minY = Math.min(w.a.y, w.b.y) - half;
    const maxX = Math.max(w.a.x, w.b.x) + half;
    const maxY = Math.max(w.a.y, w.b.y) + half;
    return { minX, minY, maxX, maxY };
  }
  private wallOutlineCornersWithParams(w: Wall, thickness: number, offset: number): [Point, Point, Point, Point] {
    const dir = this.unitVector(w.a, w.b);
    const normal = { x: -dir.y, y: dir.x };
    const baseA = { x: w.a.x + normal.x * offset, y: w.a.y + normal.y * offset };
    const baseB = { x: w.b.x + normal.x * offset, y: w.b.y + normal.y * offset };
    const half = thickness / 2;
    const offsetX = normal.x * half;
    const offsetY = normal.y * half;
    return [
      { x: baseA.x + offsetX, y: baseA.y + offsetY },
      { x: baseB.x + offsetX, y: baseB.y + offsetY },
      { x: baseB.x - offsetX, y: baseB.y - offsetY },
      { x: baseA.x - offsetX, y: baseA.y - offsetY }
    ];
  }
  private wallOutlineCorners(w: Wall): [Point, Point, Point, Point] {
    return this.wallOutlineCornersWithParams(w, w.thickness, w.offset ?? 0);
  }
  wallOutlinePath(w: Wall): string {
    const corners = this.wallOutlineCorners(w);
    return `M ${corners[0].x} ${corners[0].y} L ${corners[1].x} ${corners[1].y} L ${corners[2].x} ${corners[2].y} L ${corners[3].x} ${corners[3].y} Z`;
  }
  private wallNodeDirections(node: { point: Point; anchors: WallDragAnchor[] }): WallNodeDirection[] {
    const results: WallNodeDirection[] = [];
    for (const anchor of node.anchors) {
      const other = anchor.end === 'a' ? anchor.wall.b : anchor.wall.a;
      const dx = other.x - node.point.x;
      const dy = other.y - node.point.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-3) {
        continue;
      }
      const dir = { x: dx / length, y: dy / length };
      const angle = this.normalizeAngle(Math.atan2(dir.y, dir.x));
      const half = anchor.wall.thickness / 2;
      const left = {
        x: node.point.x - dir.y * half,
        y: node.point.y + dir.x * half
      };
      const right = {
        x: node.point.x + dir.y * half,
        y: node.point.y - dir.x * half
      };
      results.push({ dir, angle, left, right, half, length, wall: anchor.wall, end: anchor.end });
    }
    results.sort((a, b) => a.angle - b.angle);
    return results;
  }
  private intersectRays(originA: Point, dirA: Point, originB: Point, dirB: Point): Point | null {
    const denom = dirA.x * dirB.y - dirA.y * dirB.x;
    if (Math.abs(denom) < 1e-6) {
      return null;
    }
    const diffX = originB.x - originA.x;
    const diffY = originB.y - originA.y;
    const t = (diffX * dirB.y - diffY * dirB.x) / denom;
    return {
      x: originA.x + dirA.x * t,
      y: originA.y + dirA.y * t
    };
  }
  private roomBounds(room: Room): Bounds {
    return {
      minX: room.x,
      minY: room.y,
      maxX: room.x + room.w,
      maxY: room.y + room.h
    };
  }
  private measurementBounds(segment: MeasurementSegment): Bounds {
    return {
      minX: Math.min(segment.a.x, segment.b.x),
      minY: Math.min(segment.a.y, segment.b.y),
      maxX: Math.max(segment.a.x, segment.b.x),
      maxY: Math.max(segment.a.y, segment.b.y)
    };
  }
  private boundsIntersect(a: Bounds, b: Bounds): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }
  private findClosestIntersection(origin: Point, candidate: Point): { point: Point; wall: Wall; s: number; t: number } | null {
    let best: { point: Point; wall: Wall; s: number; t: number } | null = null;
    this.walls.forEach(wall=>{
      const hit = this.segmentIntersectionDetailed(origin, candidate, wall.a, wall.b);
      if(!hit){ return; }
      const sClamped = Math.max(0, Math.min(1, hit.s));
      if (sClamped <= this.intersectionEpsilon) {
        return;
      }
      if (sClamped >= 1 - this.intersectionEpsilon && best) {
        return;
      }
      if (!best || sClamped < best.s) {
        best = { point: { x: Math.round(hit.point.x), y: Math.round(hit.point.y) }, wall, s: sClamped, t: Math.max(0, Math.min(1, hit.t)) };
      }
    });
    return best;
  }
  private mergeNearbyNodes(threshold = 1.5): void {
    const nodes = this.wallNodeIndex();
    let changed = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        if (this.dist(nodeA.point, nodeB.point) <= threshold) {
          const merged = {
            x: Math.round((nodeA.point.x + nodeB.point.x) / 2),
            y: Math.round((nodeA.point.y + nodeB.point.y) / 2)
          };
          nodeA.point.x = merged.x;
          nodeA.point.y = merged.y;
          nodeB.point.x = merged.x;
          nodeB.point.y = merged.y;
          nodeA.anchors.forEach(anchor => {
            anchor.point.x = merged.x;
            anchor.point.y = merged.y;
            anchor.wall[anchor.end] = anchor.point;
          });
          nodeB.anchors.forEach(anchor => {
            anchor.point.x = merged.x;
            anchor.point.y = merged.y;
            anchor.wall[anchor.end] = anchor.point;
          });
          changed = true;
        }
      }
    }
    if (changed) {
      this.invalidate3dCache();
    }
  }

  private resolveWallPoint(raw: Point): Point {
    const origin = this.wallPath.length > 0 ? this.wallPath[this.wallPath.length - 1] : this.draftA;
    let point = { ...raw };
    const snappedExisting = this.snapToExistingNode(point);
    if (snappedExisting) {
      this.guideOverlay = null;
      this.pendingIntersection = null;
      return snappedExisting;
    }
    if (origin) {
      const guided = this.applyDirectionalGuides(origin, point);
      point = guided.point;
      this.guideOverlay = guided.guide;
    } else {
      this.guideOverlay = null;
    }
    if (origin && this.angleSnap) {
      point = this.applyAngleSnap(origin, point);
    }
    if (this.snap && (!origin || !this.angleSnap)) {
      point = this.snapPoint(point);
    }
    if (origin) {
      const hit = this.findClosestIntersection(origin, point);
      if (hit) {
        point = hit.point;
        this.pendingIntersection = hit.point;
        this.guideOverlay = null;
      } else {
        this.pendingIntersection = null;
      }
    } else {
      this.pendingIntersection = null;
    }
    const after = this.snapToExistingNode(point);
    const resolved = after ?? point;
    if (origin) {
      const length = this.segLen(origin, resolved);
      if (length < this.wallMinLength) {
        const dir = this.unitVector(origin, resolved);
        const adjusted = {
          x: origin.x + dir.x * this.wallMinLength,
          y: origin.y + dir.y * this.wallMinLength
        };
        this.pendingIntersection = null;
        this.guideOverlay = null;
        this.announceConstraint(`Walls must be at least ${this.formatLength(this.wallMinLength)}. Auto-extended.`, 'warning');
        return adjusted;
      }
      if (length > this.wallMaxLength) {
        this.announceConstraint(`Warning: walls longer than ${this.formatLength(this.wallMaxLength)} may reduce accuracy.`, 'warning');
      } else {
        this.clearConstraintMessage();
      }
    }
    return resolved;
  }

  private resolveGenericPoint(raw: Point): Point {
    let point = { ...raw };
    this.pendingIntersection = null;
    const snappedExisting = this.snapToExistingNode(point);
    if (snappedExisting) {
      return snappedExisting;
    }
    if (this.snap) {
      point = this.snapPoint(point);
    }
    const after = this.snapToExistingNode(point);
    return after ?? point;
  }

  private applyAngleSnap(origin: Point, target: Point): Point {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
      return { ...target };
    }
    const step = Math.PI / 4;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / step) * step;
    return {
      x: origin.x + length * Math.cos(snapped),
      y: origin.y + length * Math.sin(snapped)
    };
  }

  private snapToExistingNode(point: Point, tolerance = 18): Point | null {
    let closest: Point | null = null;
    let best = tolerance;
    for (const node of this.wallHandlesList) {
      const d = this.dist(node.point, point);
      if (d <= best) {
        best = d;
        closest = node.point;
      }
    }
    for (const wp of this.wallPath) {
      const d = this.dist(wp, point);
      if (d <= best) {
        best = d;
        closest = wp;
      }
    }
    if (this.draftA) {
      const d = this.dist(this.draftA, point);
      if (d <= best) {
        best = d;
        closest = this.draftA;
      }
    }
    if (this.draftB && this.creating) {
      const d = this.dist(this.draftB, point);
      if (d <= best) {
        best = d;
        closest = this.draftB;
      }
    }
    return closest ? { x: closest.x, y: closest.y } : null;
  }
  // geometry helpers
  private segLen(a:Point,b:Point){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }
  private unitVector(a:Point,b:Point){
    const dx=b.x-a.x, dy=b.y-a.y; const len = Math.hypot(dx,dy) || 1;
    return { x: dx/len, y: dy/len };
  }
  private normalizeVector(vec: Point): Point {
    const len = Math.hypot(vec.x, vec.y) || 1;
    return { x: vec.x / len, y: vec.y / len };
  }
  private uid(){ return Math.random().toString(36).slice(2,9); }
  private pickRoomAtPoint(point: Point): Room | null {
    const margin = Math.max(10, this.gridSpacing * 0.1);
    for (let i = this.rooms.length - 1; i >= 0; i--) {
      const room = this.rooms[i];
      const withinX = point.x >= room.x - margin && point.x <= room.x + room.w + margin;
      const withinY = point.y >= room.y - margin && point.y <= room.y + room.h + margin;
      if (withinX && withinY) {
        return room;
      }
    }
    return null;
  }
  private pickWallAtPoint(p:Point, thresh=30){
    let best: { wall: Wall; t:number; dist:number; proj: Point }|null=null;
    for(const w of this.walls){
      const {t, dist, proj} = this.pointSegDistanceParam(p, w.a, w.b);
      const eff = Math.max(thresh, w.thickness/2);
      if(dist<=eff && t>=0 && t<=1){ if(!best || dist<best.dist) best={ wall:w, t, dist, proj}; }
    }
    return best;
  }
  private pointSegDistanceParam(p:Point, a:Point, b:Point){
    const vx=b.x-a.x, vy=b.y-a.y; const len2 = vx*vx+vy*vy || 1; const t = ((p.x-a.x)*vx + (p.y-a.y)*vy)/len2; const tt = Math.max(0,Math.min(1,t)); const proj = { x:a.x+tt*vx, y:a.y+tt*vy }; const dx=p.x-proj.x, dy=p.y-proj.y; return { t:tt, dist: Math.hypot(dx,dy), proj };
  }
  private pointKey(p:Point){ return `${p.x.toFixed(2)}:${p.y.toFixed(2)}`; }
  private wallNodeIndex(){
    const nodes = new Map<string, { point: Point; anchors: WallDragAnchor[] }>();
    for(const w of this.walls){
      const aKey = this.pointKey(w.a);
      const aAnchor: WallDragAnchor = { wall: w, end: 'a', point: w.a };
      const aEntry = nodes.get(aKey);
      if(aEntry){ aEntry.anchors.push(aAnchor); }
      else nodes.set(aKey, { point: w.a, anchors: [aAnchor] });

      const bKey = this.pointKey(w.b);
      const bAnchor: WallDragAnchor = { wall: w, end: 'b', point: w.b };
      const bEntry = nodes.get(bKey);
      if(bEntry){ bEntry.anchors.push(bAnchor); }
      else nodes.set(bKey, { point: w.b, anchors: [bAnchor] });
    }
    return Array.from(nodes.values());
  }
  get wallHandlesList(){ return this.wallNodeIndex(); }
  get visibleWallHandlesList(){
    const nodes = this.wallNodeIndex();
    const keepSelected = new Set(this.selectedWallIds);
    if (!this.showWallHandles) {
      if (keepSelected.size > 0) {
        return nodes.filter(node => node.anchors.some(anchor => keepSelected.has(anchor.wall.id)));
      }
      return [];
    }
    const view = this.currentViewBounds(this.gridSpacing * 4);
    return nodes.filter(node => {
      if (keepSelected.size > 0 && node.anchors.some(anchor => keepSelected.has(anchor.wall.id))) {
        return true;
      }
      const p = node.point;
      return p.x >= view.minX && p.x <= view.maxX && p.y >= view.minY && p.y <= view.maxY;
    });
  }
  get cornerAngleLabels(): CornerAngleLabel[] {
    if (this.lodDetail !== 'high') {
      return [];
    }
    const view = this.currentViewBounds(this.gridSpacing * 1.5);
    const nodes = this.wallNodeIndex();
    const labels: CornerAngleLabel[] = [];
    const baseRadius = Math.max(120, this.gridSpacing * 1.2);
    const labelOffset = Math.max(60, this.gridSpacing * 0.8);
    const minAngle = 5 * Math.PI / 180;
    nodes.forEach(node => {
      const { point } = node;
      if (point.x < view.minX || point.x > view.maxX || point.y < view.minY || point.y > view.maxY) {
        return;
      }
      const directions = this.wallNodeDirections(node);
      if (directions.length < 2) {
        return;
      }
      const localRadius = Math.max(baseRadius, Math.max(...directions.map(d => d.half)) * 2);
      const labelRadius = localRadius + labelOffset;
      const segments: { start: number; size: number }[] = [];
      for (let i = 0; i < directions.length; i++) {
        if (directions.length === 2 && i === 1) {
          continue;
        }
        const current = directions[i];
        const next = directions[(i + 1) % directions.length];
        let diff = next.angle - current.angle;
        if (diff <= 0) {
          diff += Math.PI * 2;
        }
        segments.push({ start: current.angle, size: diff });
      }
      let arcs: { start: number; size: number }[] = [];
      if (directions.length === 2) {
        const chosen = segments.reduce((best, seg) => (seg.size < best.size ? seg : best));
        if (chosen.size >= minAngle && chosen.size <= Math.PI - 1e-3) {
          arcs = [chosen];
        }
      } else {
        arcs = segments.filter(seg => seg.size >= minAngle && seg.size <= Math.PI - 1e-3);
      }
      arcs.forEach((arc, idx) => {
        const mid = arc.start + arc.size / 2;
        const degrees = arc.size * 180 / Math.PI;
        const text = this.formatAngleLabel(degrees);
        if (!text) {
          return;
        }
        const path = this.describeAngleArc(point.x, point.y, localRadius, arc.start, arc.start + arc.size);
        const labelX = point.x + Math.cos(mid) * labelRadius;
        const labelY = point.y + Math.sin(mid) * labelRadius;
        labels.push({
          id: `${this.pointKey(point)}:${idx}`,
          cx: point.x,
          cy: point.y,
          x: labelX,
          y: labelY,
          text,
          path
        });
      });
    });
    return labels;
  }
  get cornerJoinOverlays(): CornerJoinOverlay[] {
    if (this.wallJoinStyle === 'butt') {
      return [];
    }
    const overlays: CornerJoinOverlay[] = [];
    const nodes = this.wallNodeIndex();
    const view = this.currentViewBounds(this.gridSpacing * 1.5);
    const minAngle = 5 * Math.PI / 180;
    nodes.forEach(node => {
      const { point } = node;
      if (point.x < view.minX || point.x > view.maxX || point.y < view.minY || point.y > view.maxY) {
        return;
      }
      const directions = this.wallNodeDirections(node);
      if (directions.length < 2) {
        return;
      }
      for (let i = 0; i < directions.length; i++) {
        const current = directions[i];
        const next = directions[(i + 1) % directions.length];
        let angleSize = next.angle - current.angle;
        if (angleSize <= 0) {
          angleSize += Math.PI * 2;
        }
        if (angleSize < minAngle) {
          continue;
        }
        if (this.wallJoinStyle === 'miter' && angleSize >= Math.PI - 1e-3) {
          continue;
        }
        if (this.wallJoinStyle === 'round' && angleSize >= Math.PI * 1.2) {
          continue;
        }
        const highlight =
          this.selectedWallIds.includes(current.wall.id) || this.selectedWallIds.includes(next.wall.id);
        const baseFill = highlight ? '#2563eb' : '#111827';
        if (this.wallJoinStyle === 'miter') {
          let joinPoint = this.intersectRays(current.left, current.dir, next.right, next.dir);
          const maxReach = Math.min(Math.min(current.length, next.length), Math.max(current.half, next.half) * 3.2 + 80);
          if (
            !joinPoint ||
            !Number.isFinite(joinPoint.x) ||
            !Number.isFinite(joinPoint.y) ||
            this.dist(joinPoint, point) > maxReach
          ) {
            const bisectorDir = this.normalizeVector({
              x: current.dir.x + next.dir.x,
              y: current.dir.y + next.dir.y
            });
            const fallback = this.dist(bisectorDir, { x: 0, y: 0 }) < 1e-3 ? current.dir : bisectorDir;
            joinPoint = {
              x: point.x + fallback.x * maxReach,
              y: point.y + fallback.y * maxReach
            };
          }
          const path = `M ${point.x} ${point.y} L ${current.left.x} ${current.left.y} L ${joinPoint.x} ${joinPoint.y} L ${next.right.x} ${next.right.y} Z`;
          overlays.push({
            id: `${this.pointKey(point)}:${i}:miter`,
            path,
            fill: baseFill
          });
          continue;
        }
        if (this.wallJoinStyle === 'round') {
          const radius = Math.max(current.half, next.half);
          let controlDir = this.normalizeVector({
            x: current.dir.x + next.dir.x,
            y: current.dir.y + next.dir.y
          });
          if (Math.abs(controlDir.x) < 1e-3 && Math.abs(controlDir.y) < 1e-3) {
            controlDir = current.dir;
          }
          const control = {
            x: point.x + controlDir.x * radius * 1.8,
            y: point.y + controlDir.y * radius * 1.8
          };
          const path = `M ${point.x} ${point.y} L ${current.left.x} ${current.left.y} Q ${control.x} ${control.y} ${next.right.x} ${next.right.y} Z`;
          overlays.push({
            id: `${this.pointKey(point)}:${i}:round`,
            path,
            fill: baseFill
          });
        }
      }
    });
    return overlays;
  }

  private computeBodyDragDelta(
    drag: { start: Point; walls: { wall: Wall; originalA: Point; originalB: Point }[] },
    target: Point
  ): { dx: number; dy: number } {
    const rawDx = target.x - drag.start.x;
    const rawDy = target.y - drag.start.y;
    let dx = rawDx;
    let dy = rawDy;
    if (!this.snap) {
      return { dx, dy };
    }
    const start = drag.start;
    const gridTarget = this.snapPoint({ x: start.x + rawDx, y: start.y + rawDy });
    const gridTolerance = Math.max(this.gridSpacing * 0.4, 8);
    if (Math.abs(gridTarget.x - (start.x + rawDx)) <= gridTolerance) {
      dx = gridTarget.x - start.x;
    }
    if (Math.abs(gridTarget.y - (start.y + rawDy)) <= gridTolerance) {
      dy = gridTarget.y - start.y;
    }
    const snapTolerance = Math.max(10, this.gridSpacing * 0.25);
    const movingIds = new Set(drag.walls.map(entry => entry.wall.id));
    const movingPoints = drag.walls.flatMap(entry => [entry.originalA, entry.originalB]);
    const candidateNodes: Point[] = [];
    for (const node of this.wallNodeIndex()) {
      if (node.anchors.every(anchor => movingIds.has(anchor.wall.id))) {
        continue;
      }
      if (!node.anchors.some(anchor => !movingIds.has(anchor.wall.id))) {
        continue;
      }
      candidateNodes.push({ x: node.point.x, y: node.point.y });
    }
    let bestDxAdjust = 0;
    let bestDyAdjust = 0;
    let bestDxAbs = snapTolerance;
    let bestDyAbs = snapTolerance;
    movingPoints.forEach(orig => {
      const movedX = orig.x + dx;
      const movedY = orig.y + dy;
      candidateNodes.forEach(targetNode => {
        const diffX = targetNode.x - movedX;
        const absDiffX = Math.abs(diffX);
        if (absDiffX < bestDxAbs) {
          bestDxAbs = absDiffX;
          bestDxAdjust = diffX;
        }
        const diffY = targetNode.y - movedY;
        const absDiffY = Math.abs(diffY);
        if (absDiffY < bestDyAbs) {
          bestDyAbs = absDiffY;
          bestDyAdjust = diffY;
        }
      });
    });
    if (bestDxAbs < snapTolerance) {
      dx += bestDxAdjust;
    }
    if (bestDyAbs < snapTolerance) {
      dy += bestDyAdjust;
    }
    return { dx, dy };
  }

  private updateDragMeasurements(): void {
    const drag = this.dragging;
    if (!drag) {
      this.draggingMeasurements = [];
      this.draggingDeltaLabel = null;
      return;
    }
    if (drag.kind === 'wall-node') {
      const segments: MeasurementSegment[] = [];
      const seen = new Set<string>();
      drag.anchors.forEach(anchor => {
        const { wall } = anchor;
        if (seen.has(wall.id)) {
          return;
        }
        seen.add(wall.id);
        segments.push({
          id: `drag-wall-${wall.id}`,
          a: { x: wall.a.x, y: wall.a.y },
          b: { x: wall.b.x, y: wall.b.y },
          length: this.segLen(wall.a, wall.b)
        });
      });
      this.draggingMeasurements = segments;
      const node = drag.anchors[0]?.point;
      if (node) {
        const dx = node.x - drag.start.x;
        const dy = node.y - drag.start.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const text = `${this.formatSignedLength(dx)} ΔX · ${this.formatSignedLength(dy)} ΔY`;
          this.draggingDeltaLabel = {
            position: { x: node.x + 40, y: node.y - 40 },
            text
          };
        } else {
          this.draggingDeltaLabel = null;
        }
      } else {
        this.draggingDeltaLabel = null;
      }
      return;
    }
    if (drag.kind === 'wall-body') {
      const segments = drag.walls.map(entry => ({
        id: `drag-body-${entry.wall.id}`,
        a: { x: entry.wall.a.x, y: entry.wall.a.y },
        b: { x: entry.wall.b.x, y: entry.wall.b.y },
        length: this.segLen(entry.wall.a, entry.wall.b)
      }));
      this.draggingMeasurements = segments;
      const delta = drag.delta ?? { x: 0, y: 0 };
      const dx = delta.x;
      const dy = delta.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const text = `${this.formatSignedLength(dx)} ΔX · ${this.formatSignedLength(dy)} ΔY`;
        this.draggingDeltaLabel = {
          position: { x: drag.start.x + dx + 40, y: drag.start.y + dy - 40 },
          text
        };
      } else {
        this.draggingDeltaLabel = null;
      }
      return;
    }
    if (drag.kind === 'room-corner') {
      const room = this.rooms.find(r => r.id === drag.roomId);
      if (!room) {
        this.draggingMeasurements = [];
        this.draggingDeltaLabel = null;
        return;
      }
      const segments: MeasurementSegment[] = [];
      if (room.w > 0) {
        segments.push({
          id: `drag-room-width-${room.id}`,
          a: { x: room.x, y: room.y },
          b: { x: room.x + room.w, y: room.y },
          length: room.w
        });
      }
      if (room.h > 0) {
        segments.push({
          id: `drag-room-height-${room.id}`,
          a: { x: room.x + room.w, y: room.y },
          b: { x: room.x + room.w, y: room.y + room.h },
          length: room.h
        });
      }
      this.draggingMeasurements = segments;
      const cornerPoint = (() => {
        switch (drag.corner) {
          case 'nw':
            return { x: room.x, y: room.y };
          case 'ne':
            return { x: room.x + room.w, y: room.y };
          case 'sw':
            return { x: room.x, y: room.y + room.h };
          case 'se':
            return { x: room.x + room.w, y: room.y + room.h };
        }
      })();
      if (cornerPoint) {
        const dx = cornerPoint.x - drag.start.x;
        const dy = cornerPoint.y - drag.start.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const text = `${this.formatSignedLength(dx)} ΔX · ${this.formatSignedLength(dy)} ΔY`;
          this.draggingDeltaLabel = {
            position: { x: cornerPoint.x + 40, y: cornerPoint.y - 40 },
            text
          };
        } else {
          this.draggingDeltaLabel = null;
        }
      } else {
        this.draggingDeltaLabel = null;
      }
    }
  }
  get visibleWalls(): Wall[] {
    const view = this.currentViewBounds(this.gridSpacing * 4);
    return this.walls.filter(w => {
      if (this.selectedWallIds.includes(w.id)) {
        return true;
      }
      return this.boundsIntersect(this.wallBounds(w), view);
    });
  }
  get visibleRooms(): Room[] {
    const view = this.currentViewBounds(this.gridSpacing * 4);
    return this.rooms.filter(room => {
      if (this.selectedRoomId === room.id) {
        return true;
      }
      return this.boundsIntersect(this.roomBounds(room), view);
    });
  }
  get visibleMeasurements(): MeasurementSegment[] {
    if (this.lodDetail === 'low') {
      return [];
    }
    const view = this.currentViewBounds(this.gridSpacing * 3);
    return this.measurements.filter(segment => this.boundsIntersect(this.measurementBounds(segment), view));
  }
  get selectedWall(): Wall | null {
    if(!this.selectedWallId) return null;
    return this.walls.find(w=>w.id===this.selectedWallId) ?? null;
  }
  get selectedWalls(): Wall[] {
    if (this.selectedWallIds.length === 0) {
      return [];
    }
    const lookup = new Set(this.selectedWallIds);
    return this.walls.filter(w => lookup.has(w.id));
  }
  private calculateSelectedWallLength(): number {
    return this.selectedWalls.reduce((total, wall) => total + this.segLen(wall.a, wall.b), 0);
  }
  get totalSelectedWallLength(): number {
    return this.calculateSelectedWallLength();
  }
  get selectedWallsThicknessValue(): number | null {
    const walls = this.selectedWalls;
    if (!walls.length) {
      return null;
    }
    const first = walls[0].thickness;
    const uniform = walls.every(w => Math.abs(w.thickness - first) < 0.5);
    return uniform ? first : null;
  }
  get selectedWallsHeightValue(): number | null {
    const walls = this.selectedWalls;
    if (!walls.length) {
      return null;
    }
    const first = walls[0].height;
    const uniform = walls.every(w => Math.abs(w.height - first) < 0.5);
    return uniform ? first : null;
  }

  get selectedWallOrientation(): { angle: number; classification: 'horizontal'|'vertical'|'diagonal'; bearing: string } | null {
    const wall = this.selectedWall;
    if (!wall) {
      return null;
    }
    const angle = this.wallAngleDegrees(wall);
    return {
      angle,
      classification: this.classifyWallAngle(angle),
      bearing: this.bearingFromAngle(angle)
    };
  }
  get selectedWallsTypeValue(): WallType | null {
    const walls = this.selectedWalls;
    if (!walls.length) {
      return null;
    }
    const first = walls[0].type;
    const uniform = walls.every(w => w.type === first);
    return uniform ? first : null;
  }
  onSelectedWallsThicknessInput(value: string): void {
    if (!this.selectedWalls.length) {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      this.pendingThickness = null;
      this.thicknessPreviewPaths = [];
      return;
    }
    const thickness = Math.max(40, Math.round(parsed));
    this.pendingThickness = thickness;
    this.updateThicknessPreview(thickness, this.thicknessAnchor);
  }
  onSelectedWallsHeightInput(value: string): void {
    if (!this.selectedWalls.length) {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const height = Math.max(1000, Math.round(parsed));
    this.applySelectedWallsHeight(height);
  }
  onThicknessPresetChange(value: string): void {
    if (!value) {
      return;
    }
    const preset = Number(value);
    if (!Number.isFinite(preset)) {
      return;
    }
    this.pendingThickness = Math.max(40, Math.round(preset));
    this.updateThicknessPreview(this.pendingThickness, this.thicknessAnchor);
  }
  setThicknessAnchor(anchor: 'center'|'left'|'right'): void {
    this.thicknessAnchor = anchor;
    if (this.pendingThickness !== null) {
      this.updateThicknessPreview(this.pendingThickness, anchor);
    }
  }
  applyPendingThickness(): void {
    if (this.pendingThickness === null) {
      return;
    }
    this.applySelectedWallsThickness(this.pendingThickness, this.thicknessAnchor);
    this.pendingThickness = null;
    this.thicknessPreviewPaths = [];
  }
  cancelThicknessPreview(): void {
    this.pendingThickness = null;
    this.thicknessPreviewPaths = [];
  }
  applyStandardHeight(value: string): void {
    if (!value) {
      return;
    }
    const preset = Number(value);
    if (!Number.isFinite(preset)) {
      return;
    }
    const height = Math.max(1000, Math.round(preset));
    this.applySelectedWallsHeight(height);
  }
  private updateThicknessPreview(thickness: number, anchor: 'center'|'left'|'right'): void {
    const walls = this.selectedWalls;
    if (!walls.length) {
      this.thicknessPreviewPaths = [];
      return;
    }
    this.thicknessPreviewPaths = walls.map(wall => {
      const offset = this.computeOffsetForAnchor(wall, thickness, anchor);
      const corners = this.wallOutlineCornersWithParams(wall, thickness, offset);
      const path = `M ${corners[0].x} ${corners[0].y} L ${corners[1].x} ${corners[1].y} L ${corners[2].x} ${corners[2].y} L ${corners[3].x} ${corners[3].y} Z`;
      return { id: wall.id, path };
    });
  }
  private computeOffsetForAnchor(wall: Wall, thickness: number, anchor: 'center'|'left'|'right'): number {
    const oldHalf = wall.thickness / 2;
    const newHalf = thickness / 2;
    const oldOffset = wall.offset ?? 0;
    if (anchor === 'center') {
      return 0;
    }
    if (anchor === 'left') {
      return oldOffset + (oldHalf - newHalf);
    }
    return oldOffset - (oldHalf - newHalf);
  }
  private applySelectedWallsThickness(thickness: number, anchor: 'center'|'left'|'right', recordUndo = true): void {
    const walls = this.selectedWalls;
    if (!walls.length) {
      return;
    }
    if (recordUndo) {
      this.pushUndoState('wall thickness change');
    }
    walls.forEach(wall => {
      wall.offset = this.computeOffsetForAnchor(wall, thickness, anchor);
      wall.thickness = thickness;
    });
    this.wallThickness = thickness;
    this.rebuildMeshes();
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
    this.updateSelectedWallPoint();
    const label = this.selectedWallIds.length > 1 ? `${this.selectedWallIds.length} walls` : 'Wall';
    this.setSaveState('idle', `${label} thickness set to ${thickness} mm (${anchor}).`);
  }
  private applySelectedWallsHeight(height: number): void {
    const walls = this.selectedWalls;
    if (!walls.length) {
      return;
    }
    this.pushUndoState('wall height change');
    walls.forEach(wall => {
      wall.height = height;
    });
    this.wallHeight = height;
    this.rebuildMeshes();
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
    this.updateSelectedWallPoint();
    const label = this.selectedWallIds.length > 1 ? `${this.selectedWallIds.length} walls` : 'Wall';
    this.setSaveState('idle', `${label} height set to ${height} mm.`);
  }
  setWallType(type: WallType): void {
    this.currentWallType = type;
    const walls = this.selectedWalls;
    if (!walls.length) {
      this.setSaveState('idle', `New walls will default to ${type} type.`);
      return;
    }
    this.pushUndoState('wall type change');
    walls.forEach(wall => {
      wall.type = type;
    });
    this.rebuildMeshes();
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
    const label = walls.length > 1 ? `${walls.length} walls` : 'Wall';
    this.setSaveState('idle', `${label} set to ${type} type.`);
  }
  private syncPrimarySelection(preferredId?: string | null): void {
    if (preferredId && this.selectedWallIds.includes(preferredId)) {
      this.selectedWallId = preferredId;
    } else if (this.selectedWallIds.length > 0) {
      this.selectedWallId = this.selectedWallIds[this.selectedWallIds.length - 1];
    } else {
      this.selectedWallId = null;
      this.selectedWallPoint = null;
      this.selectedWallT = null;
      return;
    }
    if (this.selectedWallT === null || this.selectedWallT < 0 || this.selectedWallT > 1) {
      this.selectedWallT = 0.5;
    }
    this.updateSelectedWallPoint();
  }
  get selectedRoom(): Room | null {
    if (!this.selectedRoomId) return null;
    return this.rooms.find(r => r.id === this.selectedRoomId) ?? null;
  }
  get hasSelection(): boolean {
    return this.selectedWallIds.length > 0 || Boolean(this.selectedRoomId);
  }
  wallTooltipStyle(){
    if(!this.selectedWallPoint){ return { display: 'none' }; }
    const el = this.paneElement();
    if(!el || !el.clientWidth || !el.clientHeight){ return { display: 'none' }; }
    const xRatio = (this.selectedWallPoint.x - this.minX) / this.width;
    const yRatio = (this.selectedWallPoint.y - this.minY) / this.height;
    const left = Math.max(0, Math.min(1, xRatio)) * el.clientWidth;
    const top = Math.max(0, Math.min(1, yRatio)) * el.clientHeight;
    return { left: `${left}px`, top: `${top}px` };
  }
  private updateSelectedWallPoint(){
    if(!this.selectedWallId || this.selectedWallT===null){
      this.selectedWallPoint=null;
      this.refreshSplitHints();
      return;
    }
    const wall = this.selectedWall;
    if(!wall){
      this.selectedWallIds = this.selectedWallIds.filter(id => id !== this.selectedWallId);
      this.selectedWallId = null;
      this.selectedWallPoint = null;
      this.selectedWallT = null;
      this.syncPrimarySelection();
      this.refreshSplitHints();
      return;
    }
    const t = Math.max(0, Math.min(1, this.selectedWallT));
    this.selectedWallPoint = {
      x: wall.a.x + (wall.b.x - wall.a.x) * t,
      y: wall.a.y + (wall.b.y - wall.a.y) * t
    };
    this.refreshSplitHints();
  }
  private refreshSplitHints(): void {
    if (!this.manualSplitActive) {
      this.splitHints = [];
      this.manualSplitPreview = null;
      this.activeSplitHintId = null;
      return;
    }
    if (this.selectedWallIds.length !== 1) {
      this.splitHints = [];
      this.manualSplitPreview = null;
      this.activeSplitHintId = null;
      this.manualSplitActive = false;
      return;
    }
    const wall = this.selectedWall;
    if (!wall) {
      this.splitHints = [];
      this.manualSplitPreview = null;
      this.activeSplitHintId = null;
      this.manualSplitActive = false;
      return;
    }
    const length = this.segLen(wall.a, wall.b);
    if (length < 1e-3) {
      this.splitHints = [];
      this.activeSplitHintId = null;
      this.manualSplitActive = false;
      return;
    }
    const fractions = [0.25, 0.5, 0.75, 1 / 3, 2 / 3];
    const hints: SplitHint[] = [];
    const seen = new Set<number>();
    fractions.forEach(frac => {
      if (frac <= this.intersectionEpsilon || frac >= 1 - this.intersectionEpsilon) {
        return;
      }
      const key = Number(frac.toFixed(4));
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      hints.push({
        id: `fraction-${key}`,
        t: frac,
        point: {
          x: wall.a.x + (wall.b.x - wall.a.x) * frac,
          y: wall.a.y + (wall.b.y - wall.a.y) * frac
        },
        offset: length * frac,
        fromEnd: length * (1 - frac)
      });
    });
    hints.sort((a, b) => a.t - b.t);
    this.splitHints = hints;
    const focusT =
      this.manualSplitPreview && this.manualSplitPreview.wallId === wall.id
        ? this.manualSplitPreview.t
        : this.selectedWallT;
    this.updateActiveSplitHint(focusT ?? null);
  }
  private updateActiveSplitHint(t: number | null): void {
    if (!this.manualSplitActive || !this.splitHints.length || t === null) {
      this.activeSplitHintId = null;
      return;
    }
    let best: SplitHint | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const hint of this.splitHints) {
      const delta = Math.abs(hint.t - t);
      if (delta < 0.03 && delta < bestDelta) {
        best = hint;
        bestDelta = delta;
      }
    }
    this.activeSplitHintId = best ? best.id : null;
  }
  private manualSplitTolerance(wall: Wall): number {
    return Math.max(24, wall.thickness);
  }
  private snapManualSplitParam(wall: Wall, t: number): number {
    const length = this.segLen(wall.a, wall.b);
    if (length < 1e-3) {
      return Math.max(0, Math.min(1, t));
    }
    const clamped = Math.max(0, Math.min(1, t));
    let bestT = clamped;
    let bestScore = Number.POSITIVE_INFINITY;
    const offset = clamped * length;
    const grid = this.gridSpacing;
    if (grid > 0) {
      const snappedOffset = Math.round(offset / grid) * grid;
      const gridDelta = Math.abs(snappedOffset - offset);
      const gridTolerance = grid * 0.15;
      if (gridDelta <= gridTolerance && gridDelta < bestScore) {
        bestScore = gridDelta;
        bestT = Math.max(0, Math.min(1, snappedOffset / length));
      }
    }
    const fractions = [0.25, 0.5, 0.75, 1 / 3, 2 / 3];
    const fractionTolerance = Math.min(120, length * 0.04);
    fractions.forEach(frac => {
      if (frac <= this.intersectionEpsilon || frac >= 1 - this.intersectionEpsilon) {
        return;
      }
      const targetOffset = frac * length;
      const delta = Math.abs(targetOffset - offset);
      if (delta <= fractionTolerance && delta < bestScore) {
        bestScore = delta;
        bestT = frac;
      }
    });
    return Math.max(0, Math.min(1, bestT));
  }
  private wallHasNodeAtParam(wall: Wall, t: number): boolean {
    const point = {
      x: wall.a.x + (wall.b.x - wall.a.x) * t,
      y: wall.a.y + (wall.b.y - wall.a.y) * t
    };
    const tolerance = Math.max(6, wall.thickness * 0.25);
    return this.wallHandlesList.some(node => {
      if (!node.anchors.some(anchor => anchor.wall.id === wall.id)) {
        return false;
      }
      return this.dist(node.point, point) <= tolerance;
    });
  }
  private includeCompositeMembers(wallId: string | null): void {
    if (!wallId) {
      return;
    }
    const wall = this.walls.find(w => w.id === wallId);
    if (!wall?.compositeId) {
      return;
    }
    const composite = this.curveComposites.get(wall.compositeId);
    if (!composite) {
      return;
    }
    const all = new Set(this.selectedWallIds);
    composite.segmentIds.forEach(id => all.add(id));
    this.selectedWallIds = Array.from(all);
  }
  private curveCompositeForWall(wallId: string | Wall | null): CurveComposite | null {
    if (!wallId) {
      return null;
    }
    const wall = typeof wallId === 'string' ? this.walls.find(w => w.id === wallId) : wallId;
    if (!wall?.compositeId) {
      return null;
    }
    const composite = this.curveComposites.get(wall.compositeId);
    return composite ?? null;
  }
  private circleFromThreePoints(a: Point, b: Point, c: Point): { center: Point; radius: number } | null {
    const d =
      2 *
      (a.x * (b.y - c.y) +
        b.x * (c.y - a.y) +
        c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-6) {
      return null;
    }
    const aSq = a.x * a.x + a.y * a.y;
    const bSq = b.x * b.x + b.y * b.y;
    const cSq = c.x * c.x + c.y * c.y;
    const ux =
      (aSq * (b.y - c.y) +
        bSq * (c.y - a.y) +
        cSq * (a.y - b.y)) /
      d;
    const uy =
      (aSq * (c.x - b.x) +
        bSq * (a.x - c.x) +
        cSq * (b.x - a.x)) /
      d;
    const center = { x: ux, y: uy };
    const radius = Math.hypot(a.x - ux, a.y - uy);
    if (!Number.isFinite(radius) || radius < 1) {
      return null;
    }
    return { center, radius };
  }
  private orientedArea(a: Point, b: Point, c: Point): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  private computeArcAngles(
    center: Point,
    start: Point,
    control: Point,
    end: Point
  ): { startAngle: number; endAngle: number; controlAngle: number; clockwise: boolean; sweep: number } | null {
    const startAngle = this.normalizeAngle(Math.atan2(start.y - center.y, start.x - center.x));
    let controlAngle = this.normalizeAngle(Math.atan2(control.y - center.y, control.x - center.x));
    let endAngle = this.normalizeAngle(Math.atan2(end.y - center.y, end.x - center.x));
    const clockwise = this.orientedArea(start, control, end) < 0;
    const twoPi = Math.PI * 2;
    const adjust = (angle: number, reference: number, cw: boolean): number => {
      let result = angle;
      if (cw) {
        while (result > reference) {
          result -= twoPi;
        }
        while (result <= reference - twoPi) {
          result += twoPi;
        }
      } else {
        while (result < reference) {
          result += twoPi;
        }
        while (result >= reference + twoPi) {
          result -= twoPi;
        }
      }
      return result;
    };
    controlAngle = adjust(controlAngle, startAngle, clockwise);
    endAngle = adjust(endAngle, controlAngle, clockwise);
    if (clockwise && endAngle >= startAngle) {
      endAngle -= twoPi;
    }
    if (!clockwise && endAngle <= startAngle) {
      endAngle += twoPi;
    }
    const sweep = clockwise ? startAngle - endAngle : endAngle - startAngle;
    if (!Number.isFinite(sweep) || sweep <= 1e-3) {
      return null;
    }
    // ensure control lies on arc span
    if (clockwise) {
      if (!(controlAngle <= startAngle + 1e-6 && controlAngle >= endAngle - 1e-6)) {
        return null;
      }
    } else if (!(controlAngle >= startAngle - 1e-6 && controlAngle <= endAngle + 1e-6)) {
      return null;
    }
    return { startAngle, endAngle, controlAngle, clockwise, sweep };
  }
  private sampleArcPoints(
    center: Point,
    radius: number,
    startAngle: number,
    endAngle: number,
    clockwise: boolean,
    closed = false
  ): Point[] {
    const span = Math.abs(clockwise ? startAngle - endAngle : endAngle - startAngle);
    const steps = Math.max(6, Math.ceil(span / (Math.PI / 18)));
    const points: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = clockwise ? startAngle - span * t : startAngle + span * t;
      points.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle)
      });
    }
    if (closed) {
      points.pop();
    }
    return points;
  }
  private computeCurveGeometry(
    start: Point,
    control: Point,
    end: Point
  ): {
    center: Point;
    radius: number;
    startAngle: number;
    endAngle: number;
    controlAngle: number;
    clockwise: boolean;
    sweep: number;
    closed: boolean;
    samplePoints: Point[];
  } | null {
    const circle = this.circleFromThreePoints(start, control, end);
    if (!circle) {
      return null;
    }
    const { center, radius } = circle;
    const angles = this.computeArcAngles(center, start, control, end);
    if (!angles) {
      return null;
    }
    const { startAngle, endAngle, controlAngle, clockwise, sweep } = angles;
    const closed = Math.abs(sweep - Math.PI * 2) < 1e-2;
    const samplePoints = this.sampleArcPoints(center, radius, startAngle, endAngle, clockwise, closed);
    if (samplePoints.length < (closed ? 3 : 2)) {
      return null;
    }
    return { center, radius, startAngle, endAngle, controlAngle, clockwise, sweep, closed, samplePoints };
  }
  private buildCurveComposite(
    start: Point,
    control: Point,
    end: Point,
    base: { thickness: number; height: number; type: WallType; offset: number; openings?: Opening[] }
  ): { composite: CurveComposite; segments: Wall[] } | null {
    const geometry = this.computeCurveGeometry(start, control, end);
    if (!geometry) {
      return null;
    }
    const { center, radius, startAngle, endAngle, clockwise, sweep, closed, samplePoints } = geometry;
    const compositeId = this.uid();
    const segments: Wall[] = [];
    const totalSegments = closed ? samplePoints.length : samplePoints.length - 1;
    const createWall = (a: Point, b: Point, t0: number, t1: number): Wall => ({
      id: this.uid(),
      a: { ...a },
      b: { ...b },
      thickness: base.thickness,
      height: base.height,
      openings: [],
      type: base.type,
      offset: base.offset ?? 0,
      compositeId,
      compositeT0: t0,
      compositeT1: t1
    });
    for (let i = 0; i < samplePoints.length - 1; i++) {
      const t0 = i / totalSegments;
      const t1 = (i + 1) / totalSegments;
      segments.push(createWall(samplePoints[i], samplePoints[i + 1], t0, t1));
    }
    if (closed) {
      const last = samplePoints[samplePoints.length - 1];
      const first = samplePoints[0];
      segments.push(createWall(last, first, (samplePoints.length - 1) / totalSegments, 1));
    }
    if (base.openings && base.openings.length > 0) {
      const arcLength = radius * sweep;
      const assignOpening = (opening: Opening) => {
        const fraction = opening.offset / arcLength;
        for (const segment of segments) {
          const segLength = this.segLen(segment.a, segment.b);
          if (fraction >= (segment.compositeT0 ?? 0) && fraction <= (segment.compositeT1 ?? 0) + 1e-4) {
            const local = (fraction - (segment.compositeT0 ?? 0)) / ((segment.compositeT1 ?? 0) - (segment.compositeT0 ?? 0));
            const offset = local * segLength;
            segment.openings.push({ ...opening, offset });
            return;
          }
        }
      };
      base.openings.forEach(assignOpening);
    }
    const composite: CurveComposite = {
      id: compositeId,
      segmentIds: segments.map(seg => seg.id),
      center,
      radius,
      startAngle,
      endAngle,
      clockwise,
      control: { ...control },
      closed,
      samplePoints: segments.map(seg => seg.a).concat(segments.slice(-1).map(seg => seg.b))
    };
    return { composite, segments };
  }
  private registerCurveComposite(composite: CurveComposite, segments: Wall[]): void {
    this.curveComposites.set(composite.id, composite);
    this.walls.push(...segments);
  }
  private removeCurveComposite(id: string): void {
    const composite = this.curveComposites.get(id);
    if (!composite) {
      return;
    }
    const segmentSet = new Set(composite.segmentIds);
    this.walls = this.walls.filter(wall => !segmentSet.has(wall.id));
    this.curveComposites.delete(id);
  }
  changeMode(next: 'select'|'pan'|'wall'|'room'|'door'|'window'): void {
    if (this.mode === 'measure') {
      this.toggleMeasureMode(false);
    }
    if (this.mode === 'room' && this.creating) {
      this.creating = false;
      this.roomPath = [];
      this.roomDraftPoint = null;
      this.roomClosePreview = false;
    }
    this.curveDraft = null;
    this.curvePreview = null;
    this.mode = next;
    if (next === 'room') {
      this.setSaveState('idle', 'Room tool ready. Click to lay out corners.');
    }
  }
  activateCurveMode(): void {
    this.mode = 'curve';
    this.curveDraft = { kind: 'create', stage: 'start' };
    this.curvePreview = null;
    this.setSaveState('idle', 'Curve tool active. Click a start point.');
  }
  private resetCurveDraft(nextMode: 'stay'|'select' = 'stay'): void {
    this.curveDraft = nextMode === 'stay' ? { kind: 'create', stage: 'start' } : null;
    this.curvePreview = null;
    if (nextMode === 'select') {
      this.mode = 'select';
    }
  }
  curvePreviewPath(): string {
    if (!this.curvePreview || this.curvePreview.points.length < 2) {
      return '';
    }
    const pts = this.curvePreview.points;
    const commands = [`M ${pts[0].x} ${pts[0].y}`];
    for (let i = 1; i < pts.length; i++) {
      commands.push(`L ${pts[i].x} ${pts[i].y}`);
    }
    return commands.join(' ');
  }
  private updateCurvePreview(point: Point): void {
    if (!this.curveDraft) {
      this.curvePreview = null;
      return;
    }
    if (this.curveDraft.kind === 'create') {
      if (this.curveDraft.stage === 'start' || !this.curveDraft.start) {
        this.curvePreview = null;
        return;
      }
      if (this.curveDraft.stage === 'control') {
        const start = this.curveDraft.start;
        this.curvePreview = {
          points: [start, { ...point }],
          center: { x: (start.x + point.x) / 2, y: (start.y + point.y) / 2 },
          radius: this.segLen(start, point) / 2,
          startAngle: 0,
          endAngle: 0,
          clockwise: false
        };
        return;
      }
      if (this.curveDraft.stage === 'end' && this.curveDraft.control) {
        const geometry = this.computeCurveGeometry(this.curveDraft.start, this.curveDraft.control, point);
        if (!geometry) {
          this.curvePreview = null;
          return;
        }
        this.curvePreview = {
          points: geometry.samplePoints,
          center: geometry.center,
          radius: geometry.radius,
          startAngle: geometry.startAngle,
          endAngle: geometry.endAngle,
          clockwise: geometry.clockwise
        };
      }
      return;
    }
    if (this.curveDraft.kind === 'convert') {
      const geometry = this.computeCurveGeometry(this.curveDraft.start, point, this.curveDraft.end);
      if (!geometry) {
        this.curvePreview = null;
        return;
      }
      this.curvePreview = {
        points: geometry.samplePoints,
        center: geometry.center,
        radius: geometry.radius,
        startAngle: geometry.startAngle,
        endAngle: geometry.endAngle,
        clockwise: geometry.clockwise
      };
    }
  }
  private handleCurveClick(point: Point): void {
    const resolvedPoint = this.resolveGenericPoint(point);
    if (!this.curveDraft) {
      this.curveDraft = { kind: 'create', stage: 'start' };
    }
    if (this.curveDraft.kind === 'create') {
      if (this.curveDraft.stage === 'start') {
        this.curveDraft = { kind: 'create', stage: 'control', start: { ...resolvedPoint } };
        this.curvePreview = null;
        this.setSaveState('idle', 'Curve tool: choose an arc point.');
        return;
      }
      if (this.curveDraft.stage === 'control' && this.curveDraft.start) {
        this.curveDraft = {
          kind: 'create',
          stage: 'end',
          start: this.curveDraft.start,
          control: { ...resolvedPoint }
        };
        this.updateCurvePreview(resolvedPoint);
        this.setSaveState('idle', 'Curve tool: choose an end point.');
        return;
      }
      if (this.curveDraft.stage === 'end' && this.curveDraft.start && this.curveDraft.control) {
        const start = this.curveDraft.start;
        const control = this.curveDraft.control;
        const end = resolvedPoint;
        const radius = this.finalizeCurveCreation(start, control, end);
        if (radius === null) {
          this.setSaveState('error', 'Unable to create curve. Pick non-colinear points.');
        } else {
          this.setSaveState('success', `Curve created (radius ${this.formatLength(radius)}).`);
        }
        this.resetCurveDraft('stay');
        return;
      }
    } else if (this.curveDraft.kind === 'convert') {
      const start = this.curveDraft.start;
      const end = this.curveDraft.end;
      const radius = this.finalizeCurveConversion(this.curveDraft.wallId, start, resolvedPoint, end);
      if (radius === null) {
        this.setSaveState('error', 'Unable to convert wall to curve. Pick a different arc point.');
      } else {
        this.setSaveState('success', `Wall converted to curve (radius ${this.formatLength(radius)}).`);
      }
      this.resetCurveDraft('select');
      return;
    }
  }
  private finalizeCurveCreation(start: Point, control: Point, end: Point): number | null {
    const base = {
      thickness: this.wallThickness,
      height: this.wallHeight,
      type: this.currentWallType,
      offset: 0
    };
    const built = this.buildCurveComposite(start, control, end, base);
    if (!built) {
      return null;
    }
    this.pushUndoState('curve wall create');
    this.registerCurveComposite(built.composite, built.segments);
    this.mergeNearbyNodes();
    this.rebuildMeshes();
    this.invalidate3dCache();
    this.selectedRoomId = null;
    this.selectedWallIds = [...built.composite.segmentIds];
    this.selectedWallId = built.composite.segmentIds[built.composite.segmentIds.length - 1];
    this.selectedWallT = 1;
    this.updateSelectedWallPoint();
    this.refreshSplitHints();
    return built.composite.radius;
  }
  private finalizeCurveConversion(wallId: string, start: Point, control: Point, end: Point): number | null {
    const wall = this.walls.find(w => w.id === wallId);
    if (!wall) {
      return null;
    }
    if (wall.compositeId) {
      this.setSaveState('error', 'Curve conversion requires a straight wall.');
      return null;
    }
    const base = {
      thickness: wall.thickness,
      height: wall.height,
      type: wall.type,
      offset: wall.offset ?? 0,
      openings: wall.openings.map(opening => ({ ...opening }))
    };
    const built = this.buildCurveComposite(start, control, end, base);
    if (!built) {
      return null;
    }
    this.pushUndoState('convert wall to curve');
    this.walls = this.walls.filter(w => w.id !== wallId);
    this.registerCurveComposite(built.composite, built.segments);
    this.mergeNearbyNodes();
    this.rebuildMeshes();
    this.invalidate3dCache();
    this.selectedRoomId = null;
    this.selectedWallIds = [...built.composite.segmentIds];
    this.selectedWallId = built.composite.segmentIds[built.composite.segmentIds.length - 1];
    this.selectedWallT = 1;
    this.updateSelectedWallPoint();
    this.refreshSplitHints();
    return built.composite.radius;
  }
  private selectionBounds(): Bounds | null {
    if (this.selectedWallIds.length > 1) {
      const walls = this.selectedWalls;
      if (!walls.length) {
        return null;
      }
      let combined: Bounds | null = null;
      walls.forEach(wall => {
        const bounds = this.wallBounds(wall);
        if (!combined) {
          combined = { ...bounds };
        } else {
          combined = {
            minX: Math.min(combined.minX, bounds.minX),
            minY: Math.min(combined.minY, bounds.minY),
            maxX: Math.max(combined.maxX, bounds.maxX),
            maxY: Math.max(combined.maxY, bounds.maxY)
          };
        }
      });
      return combined;
    }
    const wall = this.selectedWall;
    if (wall) {
      const half = wall.thickness / 2;
      const minX = Math.min(wall.a.x, wall.b.x) - half;
      const minY = Math.min(wall.a.y, wall.b.y) - half;
      const maxX = Math.max(wall.a.x, wall.b.x) + half;
      const maxY = Math.max(wall.a.y, wall.b.y) + half;
      return { minX, minY, maxX, maxY };
    }
    const room = this.selectedRoom;
    if (room) {
      return {
        minX: room.x,
        minY: room.y,
        maxX: room.x + room.w,
        maxY: room.y + room.h
      };
    }
    return null;
  }
  private contentBounds(): Bounds | null {
    const points: Point[] = [];
    for (const wall of this.walls) {
      points.push(wall.a, wall.b);
    }
    for (const room of this.rooms) {
      points.push(
        { x: room.x, y: room.y },
        { x: room.x + room.w, y: room.y },
        { x: room.x, y: room.y + room.h },
        { x: room.x + room.w, y: room.y + room.h }
      );
    }
    return this.boundsFromPoints(points);
  }
  private boundsFromPoints(points: Point[]): Bounds | null {
    if (!points.length) {
      return null;
    }
    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    return { minX, minY, maxX, maxY };
  }
  private expandBounds(bounds: Bounds, padding: number, minSize: number): ViewportBox {
    const widthRaw = bounds.maxX - bounds.minX;
    const heightRaw = bounds.maxY - bounds.minY;
    let width = Math.max(widthRaw + padding * 2, minSize);
    let height = Math.max(heightRaw + padding * 2, minSize);
    const aspect = this.viewportAspectRatio();
    if (aspect > 0 && height > 0) {
      const current = width / height;
      if (current < aspect) {
        width = height * aspect;
      } else if (current > aspect) {
        height = width / aspect;
      }
    }
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    return {
      minX: centerX - width / 2,
      minY: centerY - height / 2,
      width,
      height
    };
  }
  private viewportAspectRatio(): number {
    const el = this.paneElement();
    if (el && el.clientHeight > 0) {
      return el.clientWidth / el.clientHeight;
    }
    return this.width / Math.max(this.height, 1);
  }
  private applyViewport(box: ViewportBox): void {
    let { minX, minY, width, height } = box;
    if (width < this.minViewportDimension) {
      const centerX = minX + width / 2;
      width = this.minViewportDimension;
      minX = centerX - width / 2;
    }
    if (height < this.minViewportDimension) {
      const centerY = minY + height / 2;
      height = this.minViewportDimension;
      minY = centerY - height / 2;
    }
    this.minX = minX;
    this.minY = minY;
    this.width = width;
    this.height = height;
    this.scale = 2000 / this.width;
  }
  private cancelViewportAnimation(): void {
    const tween = this.viewportTween;
    if (tween && tween.raf !== null && tween.raf !== undefined) {
      cancelAnimationFrame(tween.raf);
    }
    this.viewportTween = null;
  }
  private animateViewport(to: ViewportBox, duration = 320): void {
    const centerX = to.minX + to.width / 2;
    const centerY = to.minY + to.height / 2;
    const targetWidth = Math.max(to.width, this.minViewportDimension);
    const targetHeight = Math.max(to.height, this.minViewportDimension);
    const target: ViewportBox = {
      minX: centerX - targetWidth / 2,
      minY: centerY - targetHeight / 2,
      width: targetWidth,
      height: targetHeight
    };
    const from: ViewportBox = {
      minX: this.minX,
      minY: this.minY,
      width: this.width,
      height: this.height
    };
    const delta =
      Math.abs(target.minX - from.minX) +
      Math.abs(target.minY - from.minY) +
      Math.abs(target.width - from.width) +
      Math.abs(target.height - from.height);
    this.cancelViewportAnimation();
    if (duration <= 0 || delta < 0.1) {
      this.applyViewport(target);
      return;
    }
    const start = performance.now();
    const tween: { raf: number | null; start: number; duration: number; from: ViewportBox; to: ViewportBox } = {
      raf: null,
      start,
      duration,
      from,
      to: target
    };
    const step = (timestamp: number) => {
      const elapsed = timestamp - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = this.easeInOutQuad(progress);
      const next: ViewportBox = {
        minX: from.minX + (target.minX - from.minX) * eased,
        minY: from.minY + (target.minY - from.minY) * eased,
        width: from.width + (target.width - from.width) * eased,
        height: from.height + (target.height - from.height) * eased
      };
      this.applyViewport(next);
      if (progress < 1) {
        tween.raf = requestAnimationFrame(step);
        this.viewportTween = tween;
      } else {
        this.applyViewport(target);
        this.viewportTween = null;
      }
    };
    tween.raf = requestAnimationFrame(step);
    this.viewportTween = tween;
  }
  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  private focusSelection(mode: 'pan'|'zoom'): boolean {
    const bounds = this.selectionBounds();
    if (!bounds) {
      return false;
    }
    if (mode === 'pan') {
      const margin = Math.max(this.gridSpacing, 120);
      const widthNeeded = bounds.maxX - bounds.minX + margin * 2;
      const heightNeeded = bounds.maxY - bounds.minY + margin * 2;
      if (widthNeeded > this.width || heightNeeded > this.height) {
        return this.focusSelection('zoom');
      }
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const target: ViewportBox = {
        minX: centerX - this.width / 2,
        minY: centerY - this.height / 2,
        width: this.width,
        height: this.height
      };
      const shiftX = Math.abs(target.minX - this.minX);
      const shiftY = Math.abs(target.minY - this.minY);
      if (shiftX < 1 && shiftY < 1) {
        return false;
      }
      this.animateViewport(target, 280);
      return true;
    }
    const padding = Math.max(this.gridSpacing * 0.8, 120);
    const minSize = Math.max(this.minViewportDimension, padding * 2);
    const target = this.expandBounds(bounds, padding, minSize);
    this.animateViewport(target, 360);
    return true;
  }
  zoomSelection(): void {
    if (this.focusSelection('zoom')) {
      this.setSaveState('idle', 'Zoomed to selection.');
    } else {
      this.setSaveState('idle', 'Select a wall or room to zoom.');
    }
  }
  private moveWallNode(point: Point, to: Point){
    const targetKey = this.pointKey(point);
    const nodes = this.wallNodeIndex();
    const entry = nodes.find(n=>this.pointKey(n.point)===targetKey);
    if(entry){
      const previous = entry.anchors.map(anchor => ({
        anchor,
        x: anchor.point.x,
        y: anchor.point.y
      }));
      entry.anchors.forEach(anchor=>{
        anchor.point.x = to.x;
        anchor.point.y = to.y;
        anchor.wall[anchor.end] = anchor.point;
      });
      let violated = false;
      for (const { anchor } of entry.anchors.map(a => ({ anchor: a }))) {
        const length = this.segLen(anchor.wall.a, anchor.wall.b);
        if (length < this.wallMinLength) {
          violated = true;
          this.announceConstraint(`Walls must be at least ${this.formatLength(this.wallMinLength)}. Move cancelled.`, 'error');
          break;
        }
        if (length > this.wallMaxLength) {
          this.announceConstraint(`Warning: walls longer than ${this.formatLength(this.wallMaxLength)} may reduce accuracy.`, 'warning');
        }
      }
      if (violated) {
        previous.forEach(state=>{
          state.anchor.point.x = state.x;
          state.anchor.point.y = state.y;
          state.anchor.wall[state.anchor.end] = state.anchor.point;
        });
      } else {
        this.clearConstraintMessage();
        this.reconcileWallGeometry(entry.anchors.map(anchor => anchor.wall));
      }
    } else {
      point.x = to.x;
      point.y = to.y;
      this.mergeNearbyNodes();
      this.rebuildMeshes();
      this.updateSelectedWallPoint();
    }
    this.pendingIntersection = null;
    this.guideOverlay = null;
  }
  private replaceWallWithSegments(originalId: string, segments: Wall[]){
    const idx = this.walls.findIndex(w=>w.id===originalId);
    if(idx===-1) return;
    this.walls.splice(idx, 1, ...segments);
    this.rebuildMeshes();
  }
  private ensureNodeAtSelection(): { point: Point; created: boolean } | null {
    const wall = this.selectedWall;
    if(!wall || this.selectedWallT===null){ return null; }
    const t = this.selectedWallT;
    if(t <= 0.001){
      this.selectedWallPoint = { x: wall.a.x, y: wall.a.y };
      this.selectedWallT = 0;
      return { point: wall.a, created: false };
    }
    if(t >= 0.999){
      this.selectedWallPoint = { x: wall.b.x, y: wall.b.y };
      this.selectedWallT = 1;
      return { point: wall.b, created: false };
    }
    const segments = this.splitWallAtPoints(wall, [t]);
    this.replaceWallWithSegments(wall.id, segments);
    const junction = segments[0].b;
    const nextSegment = segments[1] ?? segments[0];
    this.selectedWallIds = [...this.selectedWallIds.filter(id => id !== wall.id), nextSegment.id];
    this.selectedWallId = nextSegment.id;
    this.selectedWallT = segments[1] ? 0 : 1;
    this.selectedWallPoint = { x: junction.x, y: junction.y };
    this.updateSelectedWallPoint();
    return { point: junction, created: true };
  }
  private segmentIntersectionDetailed(a1:Point,a2:Point,b1:Point,b2:Point){
    const dax=a2.x-a1.x, day=a2.y-a1.y, dbx=b2.x-b1.x, dby=b2.y-b1.y;
    const denom = dax*dby - day*dbx;
    if(Math.abs(denom)<1e-6) return null;
    const s = ((a1.x-b1.x)*dby - (a1.y-b1.y)*dbx)/denom;
    const t = ((a1.x-b1.x)*day - (a1.y-b1.y)*dax)/denom;
    if(s < -this.intersectionEpsilon || s > 1 + this.intersectionEpsilon || t < -this.intersectionEpsilon || t > 1 + this.intersectionEpsilon){
      return null;
    }
    const clampedS = Math.max(0, Math.min(1, s));
    const point = { x: a1.x + clampedS*dax, y: a1.y + clampedS*day };
    return { point, s, t };
  }
  private splitWallAtPoints(w:Wall, params:number[]):Wall[]{
    if(params.length===0){ return [w]; }
    const sorted = [...params]
      .filter(t => Number.isFinite(t))
      .sort((a,b)=>a-b);
    const normalized: number[] = [];
    sorted.forEach(t=>{
      const clamped = Math.max(0, Math.min(1, t));
      if (normalized.length === 0 || Math.abs(clamped - normalized[normalized.length-1]) > 1e-4) {
        normalized.push(clamped);
      }
    });
    if (normalized.length === 0) {
      return [w];
    }
    const totalLength = this.segLen(w.a, w.b);
    if (totalLength < 1e-3) {
      return [w];
    }
    const knots = [0, ...normalized, 1];
    const extras = this.copyWallExtras(w);
    const meta: {
      startT: number;
      endT: number;
      startPoint: Point;
      endPoint: Point;
      startOffset: number;
      endOffset: number;
      length: number;
    }[] = [];
    for (let i = 0; i < knots.length - 1; i++) {
      const startT = knots[i];
      const endT = knots[i + 1];
      if (endT - startT <= 1e-6) {
        continue;
      }
      const startPoint = {
        x: w.a.x + (w.b.x - w.a.x) * startT,
        y: w.a.y + (w.b.y - w.a.y) * startT
      };
      const endPoint = {
        x: w.a.x + (w.b.x - w.a.x) * endT,
        y: w.a.y + (w.b.y - w.a.y) * endT
      };
      const startOffset = startT * totalLength;
      const endOffset = endT * totalLength;
      meta.push({
        startT,
        endT,
        startPoint,
        endPoint,
        startOffset,
        endOffset,
        length: endOffset - startOffset
      });
    }
    if (meta.length === 0) {
      return [w];
    }
    const tolerance = Math.max(1e-3, totalLength * 1e-4);
    const assignedOpenings = meta.map(() => [] as Opening[]);
    const baseOpenings = (w.openings ?? []).map(opening => ({ ...opening }));
    for (const opening of baseOpenings) {
      let targetIndex = meta.length - 1;
      for (let i = 0; i < meta.length; i++) {
        const seg = meta[i];
        if (opening.offset >= seg.startOffset - tolerance && opening.offset <= seg.endOffset + tolerance) {
          targetIndex = i;
          break;
        }
      }
      const seg = meta[targetIndex];
      const offset = this.clamp(opening.offset - seg.startOffset, 0, seg.length);
      assignedOpenings[targetIndex].push({ ...opening, offset });
    }
    const segments: Wall[] = [];
    for (let i = 0; i < meta.length; i++) {
      const seg = meta[i];
      const openings = assignedOpenings[i].sort((a, b) => a.offset - b.offset);
      const segment = {
        id: this.uid(),
        a: { ...seg.startPoint },
        b: { ...seg.endPoint },
        thickness: w.thickness,
        height: w.height,
        openings,
        ...extras
      } as Wall;
      segments.push(segment);
    }
    return segments;
  }

  private copyWallExtras(w: Wall): Record<string, unknown> {
    const extras: Record<string, unknown> = {};
    const reserved = new Set(['id', 'a', 'b', 'thickness', 'height', 'openings']);
    Object.keys(w).forEach(key => {
      if (!reserved.has(key)) {
        extras[key] = (w as Record<string, unknown>)[key];
      }
    });
    return extras;
  }
  private splitAgainstAllWalls(newWall:Wall):Wall[]{
    const cutsNew:number[]=[];
    const updates = new Map<number, number[]>();
    this.walls.forEach((w,idx)=>{
      const hit = this.segmentIntersectionDetailed(newWall.a,newWall.b,w.a,w.b);
      if(!hit){ return; }
      const sClamped = Math.max(0, Math.min(1, hit.s));
      const tClamped = Math.max(0, Math.min(1, hit.t));
      if (sClamped > this.intersectionEpsilon && sClamped < 1 - this.intersectionEpsilon) {
        cutsNew.push(sClamped);
      }
      if (tClamped > this.intersectionEpsilon && tClamped < 1 - this.intersectionEpsilon) {
        const entry = updates.get(idx);
        if (entry) { entry.push(tClamped); }
        else { updates.set(idx, [tClamped]); }
      }
    });
    const produced:Wall[]=[]; const survivors:Wall[]=[];
    this.walls.forEach((w,idx)=>{
      const cuts = updates.get(idx);
      if(cuts && cuts.length){ produced.push(...this.splitWallAtPoints(w, cuts)); }
      else survivors.push(w);
    });
    this.walls = survivors.concat(produced);
    return this.splitWallAtPoints(newWall, cutsNew);
  }

  private reconcileWallGeometry(walls: Wall[]): void {
    const seen = new Set<string>();
    const unique: Wall[] = [];
    for (const wall of walls) {
      if (!wall) {
        continue;
      }
      if (seen.has(wall.id)) {
        continue;
      }
      seen.add(wall.id);
      unique.push(wall);
    }
    this.mergeNearbyNodes();
    if (!unique.length) {
      this.rebuildMeshes();
      this.updateSelectedWallPoint();
      this.pendingIntersection = null;
      this.guideOverlay = null;
      return;
    }
    const selectionSnapshot = this.selectedWallId
      ? {
          id: this.selectedWallId,
          point: this.selectedWallPoint ? { x: this.selectedWallPoint.x, y: this.selectedWallPoint.y } : null
        }
      : null;
    unique.forEach(w => this.reflowWallWithIntersections(w));
    this.mergeNearbyNodes();
    this.rebuildMeshes();
    this.selectedWallIds = this.selectedWallIds.filter(id => this.walls.some(w => w.id === id));
    if (selectionSnapshot?.point) {
      this.restoreSelectionNearPoint(selectionSnapshot.point, selectionSnapshot.id);
    } else if (selectionSnapshot?.id) {
      if (this.walls.some(w => w.id === selectionSnapshot.id)) {
        if (!this.selectedWallIds.includes(selectionSnapshot.id)) {
          this.selectedWallIds = [...this.selectedWallIds, selectionSnapshot.id];
        }
        this.syncPrimarySelection(selectionSnapshot.id);
      } else {
        this.syncPrimarySelection();
      }
    } else {
      this.syncPrimarySelection();
    }
    this.pendingIntersection = null;
    this.guideOverlay = null;
  }

  private reflowWallWithIntersections(wall: Wall): Wall[] {
    const idx = this.walls.findIndex(existing => existing.id === wall.id);
    if (idx === -1) {
      return [];
    }
    const clone = {
      ...wall,
      a: { ...wall.a },
      b: { ...wall.b },
      openings: (wall.openings ?? []).map(opening => ({ ...opening }))
    } as Wall;
    this.walls.splice(idx, 1);
    const segments = this.splitAgainstAllWalls(clone);
    if (!segments.length) {
      return [];
    }
    segments[0].id = wall.id;
    this.walls.splice(idx, 0, ...segments);
    return segments;
  }

  private restoreSelectionNearPoint(point: Point, fallbackWallId?: string | null): void {
    let best: { wall: Wall; t: number; dist: number } | null = null;
    for (const wall of this.walls) {
      const { dist, t } = this.pointSegDistanceParam(point, wall.a, wall.b);
      if (!best || dist < best.dist) {
        best = { wall, t, dist };
      }
    }
    if (best && best.dist <= Math.max(6, best.wall.thickness / 3)) {
      if (!this.selectedWallIds.includes(best.wall.id)) {
        this.selectedWallIds = [...this.selectedWallIds, best.wall.id];
      }
      this.selectedWallId = best.wall.id;
      this.selectedWallT = best.t;
      this.updateSelectedWallPoint();
      return;
    }
    if (fallbackWallId && this.walls.some(w => w.id === fallbackWallId)) {
      if (!this.selectedWallIds.includes(fallbackWallId)) {
        this.selectedWallIds = [...this.selectedWallIds, fallbackWallId];
      }
      this.selectedWallId = fallbackWallId;
      if (this.selectedWallT === null || this.selectedWallT < 0 || this.selectedWallT > 1) {
        this.selectedWallT = 0.5;
      }
      this.updateSelectedWallPoint();
      return;
    }
    this.selectedWallIds = [];
    this.selectedWallId = null;
    this.selectedWallPoint = null;
    this.selectedWallT = null;
  }

  private normalizeAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    let result = angle % twoPi;
    if (result < 0) {
      result += twoPi;
    }
    return result;
  }

  private wallAngleDegrees(wall: Wall): number {
    const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
    return (this.normalizeAngle(angle) * 180) / Math.PI;
  }

  private classifyWallAngle(angleDeg: number): 'horizontal' | 'vertical' | 'diagonal' {
    const normalized = angleDeg % 180;
    const deltaHorizontal = Math.min(normalized, 180 - normalized);
    const deltaVertical = Math.abs(90 - normalized);
    const threshold = 7.5;
    if (deltaHorizontal <= threshold) {
      return 'horizontal';
    }
    if (deltaVertical <= threshold) {
      return 'vertical';
    }
    return 'diagonal';
  }

  private bearingFromAngle(angleDeg: number): string {
    const bearings = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const index = Math.round(angleDeg / 45) % bearings.length;
    return bearings[index];
  }

  private describeAngleArc(cx: number, cy: number, radius: number, start: number, end: number): string {
    const normalizedStart = this.normalizeAngle(start);
    let sweep = this.normalizeAngle(end) - normalizedStart;
    if (sweep <= 0) {
      sweep += Math.PI * 2;
    }
    if (sweep > Math.PI * 2) {
      sweep = Math.PI * 2;
    }
    const actualEnd = normalizedStart + sweep;
    const startPoint = {
      x: cx + Math.cos(normalizedStart) * radius,
      y: cy + Math.sin(normalizedStart) * radius
    };
    const endPoint = {
      x: cx + Math.cos(actualEnd) * radius,
      y: cy + Math.sin(actualEnd) * radius
    };
    const largeArc = sweep > Math.PI ? 1 : 0;
    return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y}`;
  }

  private formatAngleLabel(degrees: number): string {
    if (!Number.isFinite(degrees) || degrees <= 0) {
      return '';
    }
    const rounded = Math.round(degrees);
    if (Math.abs(degrees - rounded) < 0.2) {
      return `${rounded}°`;
    }
    return `${degrees.toFixed(1).replace(/\.0$/, '')}°`;
  }
  private hitHandle(p:Point): ({ kind:'wall-node'; anchors: WallDragAnchor[] } | { kind:'room-corner'; roomId: string; corner:'nw'|'ne'|'sw'|'se' } | null){
    for(const node of this.wallNodeIndex()){
      if(this.dist(p,node.point)<20){
        return { kind:'wall-node', anchors: node.anchors };
      }
    }
    // room corners
    for(const r of this.rooms){
      const pts=[ {pt:{x:r.x,y:r.y},name:'nw'}, {pt:{x:r.x+r.w,y:r.y},name:'ne'}, {pt:{x:r.x,y:r.y+r.h},name:'sw'}, {pt:{x:r.x+r.w,y:r.y+r.h},name:'se'} ] as const;
      for(const c of pts){ if(this.dist(p,c.pt)<20) return { kind:'room-corner', roomId:r.id, corner:c.name } as const; }
    }
    return null;
  }
  private samePoint(a:Point,b:Point){ return this.dist(a,b) < 1; }
  private dist(a:Point,b:Point){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }

  private polygonArea(points: Point[]): number {
    if (points.length < 3) {
      return 0;
    }
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return area / 2;
  }

  private polygonCentroid(points: Point[]): Point {
    const area = this.polygonArea(points);
    if (Math.abs(area) < 1e-6) {
      return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const cross = current.x * next.y - next.x * current.y;
      cx += (current.x + next.x) * cross;
      cy += (current.y + next.y) * cross;
    }
    const factor = 1 / (6 * area);
    return { x: cx * factor, y: cy * factor };
  }

  formatArea(areaMm2: number): string {
    if (!Number.isFinite(areaMm2) || areaMm2 <= 0) {
      return '0 m²';
    }
    const areaMeters = areaMm2 / 1_000_000;
    if (areaMeters >= 10) {
      return `${areaMeters.toFixed(1)} m²`;
    }
    if (areaMeters >= 1) {
      return `${areaMeters.toFixed(2)} m²`;
    }
    return `${(areaMeters * 10_000).toFixed(1)} cm²`;
  }

  constructor(
    private auth: CoreAuthService,
    private studio: StudioService,
    private studioState: StudioStateService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  async openPlans(): Promise<void> {
    await this.router.navigate(['/plans']);
  }

  private serialize(){
    return {
      walls:this.walls,
      rooms:this.rooms,
      view:{minX:this.minX,minY:this.minY,width:this.width,height:this.height},
      grid:{
        spacing:this.gridSpacing,
        majorEvery:this.gridMajorEvery,
        opacity:this.gridOpacity
      },
      settings:{
        wallJoinStyle:this.wallJoinStyle
      }
    };
  }

  private loadModel(m:any){
    this.clearAll();
    this.resetGridSettings();
    this.measurements = [];
    this.measureStart = null;
    this.measureDraft = null;
    this.walls = (m?.walls ?? []).map((w: Wall) => this.normalizeWall(w));
    this.rooms = (m?.rooms ?? []).map((r: Room) => ({ ...r }));
    const v=m?.view||{};
    this.minX=v.minX??this.minX;
    this.minY=v.minY??this.minY;
    this.width=v.width??this.width;
    this.height=v.height??this.height;
    const g = m?.grid || {};
    this.updateGridSpacing(g.spacing ?? this.gridSpacing);
    this.updateGridMajorEvery(g.majorEvery ?? this.gridMajorEvery);
    this.updateGridOpacity(g.opacity ?? this.gridOpacity);
    const settings = m?.settings ?? {};
    const join = settings.wallJoinStyle;
    if (join === 'butt' || join === 'miter' || join === 'round') {
      this.wallJoinStyle = join;
    } else {
      this.wallJoinStyle = 'miter';
    }
    this.rebuildMeshes();
  }

  private beginNewPlan(): void {
    this.planId = null;
    this.studioState.selectPlan(null);
    this.name = '';
    this.lastSavedAt = null;
    this.loadingPlan = false;
    this.resetGridSettings();
    this.resetView();
    this.clearAll();
    this.measureStart = null;
    this.measureDraft = null;
    this.measurements = [];
    this.wallJoinStyle = 'miter';
    this.rebuildMeshes();
    this.setSaveState('idle', 'New plan ready');
  }

  private async loadPlan(id: string): Promise<void> {
    this.loadingPlan = true;
    try {
      const fp: FloorplanRecord = await this.studio.get(id);
      this.planId = fp.id;
      this.studioState.selectPlan(fp.id);
      this.studioState.upsertPlan(fp);
      this.name = fp.name ?? '';
      this.loadModel(fp.data);
      this.lastSavedAt = fp.updatedAt ? new Date(fp.updatedAt) : null;
      const msg = this.lastSavedAt ? `Last saved ${this.lastSavedLabel()}` : 'Plan loaded';
      this.setSaveState('idle', msg);
    } catch (e: any) {
      const message = e?.message || 'Unable to load plan';
      this.setSaveState('error', message);
    } finally {
      this.loadingPlan = false;
    }
  }

  async save(): Promise<void> {
    const trimmed = this.name.trim();
    if (!trimmed) {
      this.setSaveState('error', 'Add a plan name before saving.');
      return;
    }
    this.setSaveState('saving', 'Saving...');
    try {
      const payload = this.serialize();
      let persistedId = this.planId ?? null;
      if (!persistedId) {
        persistedId = await this.studio.create(trimmed, payload, this.userUuid ?? undefined);
        this.planId = persistedId;
        await this.updateQuery({ plan: persistedId, new: null });
      } else {
        await this.studio.update(persistedId, { name: trimmed, data: payload });
      }
      this.lastSavedAt = new Date();
      const savedAtIso = this.lastSavedAt.toISOString();
      const ownerUserId = this.userUuid ?? undefined;
      if (persistedId) {
        this.studioState.selectPlan(persistedId);
        this.studioState.upsertPlan({
          id: persistedId,
          name: trimmed,
          ownerUserId,
          updatedAt: savedAtIso,
          data: payload as FloorplanRecord['data']
        });
      }
      this.setSaveState('success', `Saved at ${this.lastSavedLabel()}`);
    } catch (err: any) {
      const message = err?.message || 'Save failed';
      this.setSaveState('error', message);
    }
  }

  lastSavedLabel(): string {
    if (!this.lastSavedAt) return '';
    return this.lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  formatLength(lengthMm: number): string {
    if (this.units === 'm') {
      return `${(lengthMm / 1000).toFixed(2)} m`;
    }
    const feet = lengthMm * 0.00328084;
    return `${feet.toFixed(2)} ft`;
  }
  private formatSignedLength(lengthMm: number): string {
    const abs = Math.abs(lengthMm);
    if (abs < 0.5) {
      return this.formatLength(0);
    }
    const formatted = this.formatLength(abs);
    const sign = lengthMm >= 0 ? '+' : '-';
    return `${sign}${formatted}`;
  }
  draftWallLengthMm(): number {
    if (!(this.creating && this.mode === 'wall' && this.draftA && this.draftB)) {
      return 0;
    }
    return this.segLen(this.draftA, this.draftB);
  }
  draftWallMidpoint(): Point | null {
    if (!(this.creating && this.mode === 'wall' && this.draftA && this.draftB)) {
      return null;
    }
    return {
      x: (this.draftA.x + this.draftB.x) / 2,
      y: (this.draftA.y + this.draftB.y) / 2
    };
  }
  measurementDraftLength(): number {
    if (!(this.mode === 'measure' && this.measureStart && this.measureDraft)) {
      return 0;
    }
    return this.segLen(this.measureStart, this.measureDraft);
  }
  measurementMidpoint(segment: { a: Point; b: Point }): Point {
    return {
      x: (segment.a.x + segment.b.x) / 2,
      y: (segment.a.y + segment.b.y) / 2
    };
  }
  activeMeasurementMidpoint(): Point | null {
    if (!(this.mode === 'measure' && this.measureStart && this.measureDraft)) {
      return null;
    }
    return this.measurementMidpoint({ a: this.measureStart, b: this.measureDraft });
  }
  wallLengthMm(wall: Wall): number {
    return this.segLen(wall.a, wall.b);
  }
  adjustSelectedWall(which: 'start'|'end'|'both', delta: number): void {
    if (this.selectedWallIds.length !== 1) {
      this.setSaveState('idle', 'Select a single wall to adjust length.');
      return;
    }
    const wall = this.selectedWall;
    if (!wall || delta === 0) return;
    const length = this.segLen(wall.a, wall.b);
    if (length === 0) return;
    const dir = this.unitVector(wall.a, wall.b);
    const minLen = 100;
    let startDelta = which === 'start' || which === 'both' ? delta : 0;
    let endDelta = which === 'end' || which === 'both' ? delta : 0;
    const proposedLength = length + startDelta + endDelta;
    if (proposedLength < minLen) {
      const deficit = minLen - proposedLength;
      if (which === 'both') {
        startDelta += deficit / 2;
        endDelta += deficit / 2;
      } else if (which === 'start') {
        startDelta += deficit;
      } else {
        endDelta += deficit;
      }
    }
    if (startDelta !== 0) {
      const newStart = { x: wall.a.x - dir.x * startDelta, y: wall.a.y - dir.y * startDelta };
      this.moveWallNode(wall.a, newStart);
    }
    if (endDelta !== 0) {
      const newEnd = { x: wall.b.x + dir.x * endDelta, y: wall.b.y + dir.y * endDelta };
      this.moveWallNode(wall.b, newEnd);
    }
    this.updateSelectedWallPoint();
    this.setSaveState('idle', `Wall length: ${this.formatLength(this.segLen(wall.a, wall.b))}`);
  }

  splitSelectedWall(): void {
    if (this.selectedWallIds.length !== 1) {
      this.manualSplitActive = false;
      this.manualSplitPreview = null;
      this.splitHints = [];
      this.activeSplitHintId = null;
      this.setSaveState('idle', 'Select a single wall to split.');
      this.refreshSplitHints();
      return;
    }
    if (this.manualSplitActive) {
      this.manualSplitActive = false;
      this.manualSplitPreview = null;
      this.splitHints = [];
      this.activeSplitHintId = null;
      this.setSaveState('idle', 'Split mode cancelled.');
      this.refreshSplitHints();
      return;
    }
    this.manualSplitActive = true;
    this.manualSplitPreview = null;
    this.refreshSplitHints();
    this.setSaveState('idle', 'Split mode on. Click along the wall to add a junction (Esc to cancel).');
  }

  curveSelectedWall(): void {
    if (this.selectedWallIds.length !== 1) {
      this.setSaveState('idle', 'Select a single wall to convert.');
      return;
    }
    const wall = this.selectedWall;
    if (!wall) {
      this.setSaveState('idle', 'Select a wall to convert.');
      return;
    }
    if (wall.compositeId) {
      this.setSaveState('idle', 'Wall is already part of a curve.');
      return;
    }
    const length = this.segLen(wall.a, wall.b);
    if (length < 200) {
      this.setSaveState('idle', 'Wall too short to curve.');
      return;
    }
    this.mode = 'curve';
    this.curveDraft = {
      kind: 'convert',
      stage: 'control',
      wallId: wall.id,
      start: { x: wall.a.x, y: wall.a.y },
      end: { x: wall.b.x, y: wall.b.y }
    };
    this.curvePreview = null;
    this.setSaveState('idle', 'Curve conversion: select an arc point to define the curve.');
  }

  branchFromSelectedWall(): void {
    if (this.selectedWallIds.length !== 1) {
      this.setSaveState('idle', 'Select a single wall to branch from.');
      return;
    }
    const result = this.ensureNodeAtSelection();
    if (!result) return;
    const start = result.point;
    this.toolset = 'build';
    this.curveDraft = null;
    this.curvePreview = null;
    this.mode = 'wall';
    this.creating = true;
    this.wallPath = [start];
    this.draftA = start;
    this.draftB = start;
    this.selectedWallIds = [];
    this.selectedWallId = null;
    this.selectedWallPoint = null;
    this.selectedWallT = null;
    this.guideOverlay = null;
    this.pendingIntersection = null;
    this.setSaveState('idle', 'Branching wall: click to add the next point.');
  }

  deleteSelectedWall(confirmDeletion = true): void {
    if (this.selectedWallIds.length === 0) {
      this.setSaveState('idle', 'Select walls to delete.');
      return;
    }
    const targets = this.walls.filter(w => this.selectedWallIds.includes(w.id));
    if (targets.length === 0) {
      return;
    }
    if (confirmDeletion) {
      const withOpenings = targets.filter(w => w.openings.length > 0);
      if (withOpenings.length > 0) {
        const message =
          `${withOpenings.length} wall${withOpenings.length === 1 ? '' : 's'} contain openings. Delete anyway?`;
        if (!window.confirm(message)) {
          this.setSaveState('idle', 'Deletion cancelled.');
          return;
        }
      }
    }
    const description = targets.length === 1 ? 'wall deletion' : `deletion of ${targets.length} walls`;
    this.pushUndoState(description);
    this.applyWallDeletion(new Set(targets.map(w => w.id)));
  }

  private applyWallDeletion(targetIds: Set<string>): void {
    const expandedIds = new Set(targetIds);
    this.curveComposites.forEach((composite, id) => {
      if (composite.segmentIds.some(segId => targetIds.has(segId))) {
        composite.segmentIds.forEach(segId => expandedIds.add(segId));
        this.curveComposites.delete(id);
      }
    });
    const removedCount = expandedIds.size;
    if (removedCount === 0) {
      return;
    }
    this.walls = this.walls.filter(w => !expandedIds.has(w.id));
    this.clearSelection();
    this.rebuildMeshes();
    this.setSaveState('idle', `${removedCount} wall${removedCount === 1 ? '' : 's'} removed.`);
  }

  toggleMeasureMode(force?: boolean): void {
    const next = force !== undefined ? force : this.mode !== 'measure';
    if (next) {
      if (this.creating) {
        this.finishWallDrawing();
      }
      this.mode = 'measure';
      this.measureStart = null;
      this.measureDraft = null;
      this.setSaveState('idle', 'Measurement mode on. Click two points to measure.');
    } else {
      this.mode = 'select';
      this.measureStart = null;
      this.measureDraft = null;
      this.setSaveState('idle', 'Measurement mode off.');
    }
    this.guideOverlay = null;
    this.pendingIntersection = null;
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
  }

  clearMeasurements(): void {
    if (this.measurements.length === 0) {
      return;
    }
    this.measurements = [];
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
    this.setSaveState('idle', 'Measurements cleared.');
  }

  private rebuildMeshes(): void {
    const wallFaces: WallFace[] = [];
    for (const wall of this.walls) {
      const corners = this.wallOutlineCorners(wall);
      wallFaces.push({ id: wall.id, wallId: wall.id, corners });
    }
    const roomMeshes: RoomMesh[] = this.rooms.map(room => ({
      id: room.id,
      faces: [[
        { x: room.x, y: room.y },
        { x: room.x + room.w, y: room.y },
        { x: room.x + room.w, y: room.y + room.h },
        { x: room.x, y: room.y + room.h }
      ]]
    }));
    this.wallFaces = wallFaces;
    this.roomMeshes = roomMeshes;
    this.invalidate3dCache();
    if (this.viewPort === '3d') {
      this.scheduleFrame();
    }
  }

  private normalizeWall(raw: any): Wall {
    const openings: Opening[] = Array.isArray(raw?.openings)
      ? raw.openings.map((o: Opening) => ({ ...o }))
      : [];
    const type: WallType = raw?.type ?? 'interior';
    const offset = typeof raw?.offset === 'number' ? raw.offset : 0;
    return {
      id: raw?.id ?? this.uid(),
      a: { x: raw?.a?.x ?? 0, y: raw?.a?.y ?? 0 },
      b: { x: raw?.b?.x ?? 0, y: raw?.b?.y ?? 0 },
      thickness: Math.max(1, Math.round(raw?.thickness ?? this.wallThickness)),
      height: Math.max(1000, Math.round(raw?.height ?? this.wallHeight)),
      openings,
      type,
      offset
    };
  }

  private cloneWalls(walls: Wall[]): Wall[] {
    return walls.map(w => this.normalizeWall(w));
  }

  private cloneRooms(rooms: Room[]): Room[] {
    return rooms.map(r => ({ ...r }));
  }

  private createSnapshot(description: string): StudioSnapshot {
    return {
      walls: this.cloneWalls(this.walls),
      rooms: this.cloneRooms(this.rooms),
      description
    };
  }

  private pushUndoState(description: string): void {
    this.undoStack.push(this.createSnapshot(description));
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undoLastAction(): void {
    if (this.undoStack.length === 0) {
      this.setSaveState('idle', 'Nothing to undo.');
      return;
    }
    const snapshot = this.undoStack.pop()!;
    this.redoStack.push(this.createSnapshot(snapshot.description));
    this.restoreSnapshot(snapshot);
    this.setSaveState('success', `Undid ${snapshot.description}.`);
  }

  redoLastAction(): void {
    if (this.redoStack.length === 0) {
      this.setSaveState('idle', 'Nothing to redo.');
      return;
    }
    const snapshot = this.redoStack.pop()!;
    this.undoStack.push(this.createSnapshot(snapshot.description));
    this.restoreSnapshot(snapshot);
    this.setSaveState('success', `Redid ${snapshot.description}.`);
  }

  private restoreSnapshot(snapshot: StudioSnapshot): void {
    this.walls = this.cloneWalls(snapshot.walls);
    this.rooms = this.cloneRooms(snapshot.rooms);
    this.clearSelection();
    this.rebuildMeshes();
  }

  private scheduleFrame(): void {
    if (this.viewPort !== '3d') {
      return;
    }
    const canvas = this.canvas3d?.nativeElement;
    if (canvas) {
      const width = canvas.clientWidth || canvas.width;
      const height = canvas.clientHeight || canvas.height;
      if (this.renderCache && (width !== this.renderCacheSize.width || height !== this.renderCacheSize.height)) {
        this.invalidate3dCache();
      }
      if (!this.autoOrbit && !this.dirty3d && this.renderCache) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          try {
            ctx.putImageData(this.renderCache, 0, 0);
            return;
          } catch {
            this.invalidate3dCache();
          }
        }
      }
    }
    if (this.animationId !== null) {
      return;
    }
    this.animationId = requestAnimationFrame(ts => this.renderFrame(ts));
  }

  private renderFrame(ts: number): void {
    this.animationId = null;
    if (this.viewPort !== '3d') {
      return;
    }
    const canvas = this.canvas3d?.nativeElement;
    if (!canvas) {
      this.animationId = requestAnimationFrame(next => this.renderFrame(next));
      return;
    }
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) {
      this.animationId = requestAnimationFrame(next => this.renderFrame(next));
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.isDark ? '#020617' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const delta = this.lastFrame ? ts - this.lastFrame : 16;
    this.lastFrame = ts;
    if (this.autoOrbit && Number.isFinite(delta)) {
      this.cam.yaw += delta * 0.00012;
    }

    const camPos = this.computeCameraPosition();
    const center = this.computeSceneCenter();
    const view = this.lookAt(camPos, center, { x: 0, y: 0, z: 1 });
    const proj = this.perspectiveMatrix(Math.PI / 3, width / height, 200, 40000);
    const matrix = this.multiplyMatrices(proj, view);

    for (const mesh of this.roomMeshes) {
      this.drawRoomMesh(ctx, matrix, mesh, width, height);
    }
    for (const face of this.wallFaces) {
      this.drawWallFace(ctx, matrix, face, width, height);
    }
    if (this.measureStart && this.measureDraft) {
      this.drawMeasurement3d(ctx, matrix, {
        id: 'draft',
        a: this.measureStart,
        b: this.measureDraft,
        length: this.segLen(this.measureStart, this.measureDraft)
      }, width, height, true);
    }
    for (const measurement of this.measurements) {
      this.drawMeasurement3d(ctx, matrix, measurement, width, height, false);
    }
    if (!this.autoOrbit) {
      try {
        this.renderCache = ctx.getImageData(0, 0, width, height);
        this.renderCacheSize = { width, height };
        this.dirty3d = false;
      } catch {
        this.renderCache = null;
        this.dirty3d = true;
      }
    } else {
      this.renderCache = null;
      this.renderCacheSize = { width: 0, height: 0 };
      this.dirty3d = true;
    }
    if (this.autoOrbit) {
      this.animationId = requestAnimationFrame(next => this.renderFrame(next));
    } else {
      this.animationId = null;
    }
  }

  private computeCameraPosition(): { x: number; y: number; z: number } {
    const center = this.computeSceneCenter();
    const distance = Math.max(this.cam.distance, 1500);
    const pitch = this.cam.pitch;
    const yaw = this.cam.yaw;
    const cosPitch = Math.cos(pitch);
    return {
      x: center.x + Math.cos(yaw) * distance * cosPitch,
      y: center.y + Math.sin(yaw) * distance * cosPitch,
      z: center.z + Math.sin(pitch) * distance
    };
  }

  private computeSceneCenter(): { x: number; y: number; z: number } {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let hasGeometry = false;
    for (const wall of this.walls) {
      minX = Math.min(minX, wall.a.x, wall.b.x);
      minY = Math.min(minY, wall.a.y, wall.b.y);
      maxX = Math.max(maxX, wall.a.x, wall.b.x);
      maxY = Math.max(maxY, wall.a.y, wall.b.y);
      hasGeometry = true;
    }
    for (const room of this.rooms) {
      minX = Math.min(minX, room.x, room.x + room.w);
      minY = Math.min(minY, room.y, room.y + room.h);
      maxX = Math.max(maxX, room.x, room.x + room.w);
      maxY = Math.max(maxY, room.y, room.y + room.h);
      hasGeometry = true;
    }
    if (!hasGeometry) {
      return { x: 0, y: 0, z: this.wallHeight / 2 };
    }
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: this.wallHeight / 2
    };
  }

  private lookAt(eye: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): number[] {
    const forward = this.normalize3({
      x: eye.x - center.x,
      y: eye.y - center.y,
      z: eye.z - center.z
    });
    const right = this.normalize3(this.cross3(up, forward));
    const trueUp = this.cross3(forward, right);
    return [
      right.x, trueUp.x, forward.x, 0,
      right.y, trueUp.y, forward.y, 0,
      right.z, trueUp.z, forward.z, 0,
      -this.dot3(right, eye), -this.dot3(trueUp, eye), -this.dot3(forward, eye), 1
    ];
  }

  private perspectiveMatrix(fov: number, aspect: number, near: number, far: number): number[] {
    const f = 1 / Math.tan(fov / 2);
    const rangeInv = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, -1,
      0, 0, (2 * near * far) * rangeInv, 0
    ];
  }

  private multiplyMatrices(a: number[], b: number[]): number[] {
    const out = new Array(16).fill(0);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        out[row * 4 + col] =
          a[row * 4 + 0] * b[col + 0] +
          a[row * 4 + 1] * b[col + 4] +
          a[row * 4 + 2] * b[col + 8] +
          a[row * 4 + 3] * b[col + 12];
      }
    }
    return out;
  }

  private multiplyMatrixVector(m: number[], v: [number, number, number, number]): [number, number, number, number] {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
    ];
  }

  private transformPoint(matrix: number[], point: { x: number; y: number; z: number }, width: number, height: number):
    { x: number; y: number; depth: number } | null {
    const [x, y, z, w] = this.multiplyMatrixVector(matrix, [point.x, point.y, point.z, 1]);
    if (w <= 0) {
      return null;
    }
    const invW = 1 / w;
    const ndcX = x * invW;
    const ndcY = y * invW;
    const ndcZ = z * invW;
    return {
      x: (ndcX * 0.5 + 0.5) * width,
      y: (-ndcY * 0.5 + 0.5) * height,
      depth: ndcZ
    };
  }

  private lightingPalette(): LightingPalette {
    const base: LightingPalette = this.isDark
      ? {
          wallFill: 'rgba(59, 130, 246, 0.30)',
          wallEdge: '#60a5fa',
          wallEdgeWidth: 1,
          roomFill: 'rgba(56, 189, 248, 0.35)',
          roomEdge: '#38bdf8',
          roomEdgeWidth: 1,
          measurement: '#c084fc',
          measurementDraft: '#a855f7'
        }
      : {
          wallFill: 'rgba(59, 130, 246, 0.32)',
          wallEdge: '#1d4ed8',
          wallEdgeWidth: 1,
          roomFill: 'rgba(191, 219, 254, 0.45)',
          roomEdge: '#0284c7',
          roomEdgeWidth: 1,
          measurement: '#7c3aed',
          measurementDraft: '#a855f7'
        };
    switch (this.lightingPreset) {
      case 'unlit':
        return {
          ...base,
          wallFill: this.isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.38)',
          wallEdge: '#94a3b8',
          roomFill: this.isDark ? 'rgba(165, 180, 252, 0.35)' : 'rgba(196, 210, 253, 0.40)',
          roomEdge: '#a5b4fc',
          measurement: this.isDark ? '#f8fafc' : '#334155',
          measurementDraft: this.isDark ? '#cbd5f5' : '#94a3b8'
        };
      case 'wireframe':
        return {
          ...base,
          wallFill: null,
          roomFill: null,
          wallEdge: this.isDark ? '#e2e8f0' : '#334155',
          roomEdge: this.isDark ? '#cbd5f5' : '#475569',
          wallEdgeWidth: 1.5,
          roomEdgeWidth: 1.3,
          measurement: this.isDark ? '#facc15' : '#0f172a',
          measurementDraft: this.isDark ? '#fde68a' : '#94a3b8'
        };
      case 'detail':
        return {
          ...base,
          wallFill: this.isDark ? 'rgba(29, 78, 216, 0.55)' : 'rgba(29, 78, 216, 0.45)',
          wallEdge: this.isDark ? '#bfdbfe' : '#1d4ed8',
          wallEdgeWidth: 1.2,
          roomFill: this.isDark ? 'rgba(15, 118, 110, 0.45)' : 'rgba(34, 197, 94, 0.40)',
          roomEdge: this.isDark ? '#5eead4' : '#047857',
          roomEdgeWidth: 1.2,
          measurement: this.isDark ? '#f59e0b' : '#ea580c',
          measurementDraft: this.isDark ? '#fbbf24' : '#fb923c'
        };
      default:
        return base;
    }
  }

  private drawWallFace(ctx: CanvasRenderingContext2D, matrix: number[], face: WallFace, width: number, height: number): void {
    const palette = this.lightingPalette();
    const base = face.corners.map(c => this.transformPoint(matrix, { x: c.x, y: c.y, z: 0 }, width, height));
    const top = face.corners.map(c => this.transformPoint(matrix, { x: c.x, y: c.y, z: this.wallHeight }, width, height));
    if (!this.areProjected(base) || !this.areProjected(top)) {
      return;
    }
    const basePts = base;
    const topPts = top;
    if (palette.wallFill) {
      ctx.fillStyle = palette.wallFill;
      ctx.beginPath();
      ctx.moveTo(topPts[0].x, topPts[0].y);
      for (let i = 1; i < topPts.length; i++) {
        ctx.lineTo(topPts[i].x, topPts[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = palette.wallEdge;
    ctx.lineWidth = palette.wallEdgeWidth;
    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y);
    for (let i = 1; i < topPts.length; i++) {
      ctx.lineTo(topPts[i].x, topPts[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    for (let i = 0; i < topPts.length; i++) {
      const t = topPts[i];
      const b = basePts[i];
      ctx.strokeStyle = palette.wallEdge;
      ctx.lineWidth = palette.wallEdgeWidth;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
  }

  private drawRoomMesh(ctx: CanvasRenderingContext2D, matrix: number[], mesh: RoomMesh, width: number, height: number): void {
    const palette = this.lightingPalette();
    const allowFill = Boolean(palette.roomFill);
    for (const face of mesh.faces) {
      const projected = face.map(corner => this.transformPoint(matrix, { x: corner.x, y: corner.y, z: 0 }, width, height));
      if (!this.areProjected(projected)) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(projected[0].x, projected[0].y);
      for (let i = 1; i < projected.length; i++) {
        ctx.lineTo(projected[i].x, projected[i].y);
      }
      ctx.closePath();
      if (allowFill && palette.roomFill) {
        ctx.fillStyle = palette.roomFill;
        ctx.fill();
      }
      ctx.strokeStyle = palette.roomEdge;
      ctx.lineWidth = palette.roomEdgeWidth;
      ctx.stroke();
    }
  }

  private drawMeasurement3d(
    ctx: CanvasRenderingContext2D,
    matrix: number[],
    measurement: MeasurementSegment,
    width: number,
    height: number,
    isDraft: boolean
  ): void {
    const palette = this.lightingPalette();
    const baseHeight = isDraft ? 120 : 80;
    const a = this.transformPoint(matrix, { x: measurement.a.x, y: measurement.a.y, z: baseHeight }, width, height);
    const b = this.transformPoint(matrix, { x: measurement.b.x, y: measurement.b.y, z: baseHeight }, width, height);
    if (!a || !b) {
      return;
    }
    ctx.setLineDash(isDraft ? [4, 4] : [8, 6]);
    ctx.strokeStyle = isDraft ? palette.measurementDraft : palette.measurement;
    ctx.lineWidth = isDraft ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = isDraft ? palette.measurementDraft : palette.measurement;
    ctx.font = '12px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2 - 10;
    const label = this.formatLength(measurement.length);
    ctx.fillText(label, midX, midY);
  }

  private dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  private cross3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  private normalize3(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  private areProjected(
    points: ({ x: number; y: number; depth: number } | null)[]
  ): points is { x: number; y: number; depth: number }[] {
    return points.every((pt): pt is { x: number; y: number; depth: number } => pt !== null);
  }

  private setSaveState(state: 'idle'|'saving'|'success'|'error', message = ''): void {
    this.saveState = state;
    this.statusMessage = message;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    if (state === 'success') {
      this.statusTimer = setTimeout(() => {
        this.saveState = 'idle';
        this.statusTimer = null;
      }, 2500);
    }
  }

  private async updateQuery(params: Record<string, string | null>): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
}
