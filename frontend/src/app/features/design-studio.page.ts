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
type Wall = { id: string; a: Point; b: Point; thickness: number; height: number; openings: Opening[] };
type Room = { id: string; x: number; y: number; w: number; h: number; height: number };
type WallDragAnchor = { wall: Wall; end: 'a'|'b'; point: Point };
type MeasurementSegment = { id: string; a: Point; b: Point; length: number };
type WallFace = { id: string; corners: [Point, Point, Point, Point]; wallId: string };
type RoomMesh = { id: string; faces: Array<[Point, Point, Point, Point]> };

@Component({
  selector: 'arch-design-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './design-studio.page.html'
})
export class DesignStudioPage implements OnInit, OnDestroy {
  @ViewChild('pane') pane?: ElementRef<HTMLDivElement>;

  // UI state
  toolset: 'project'|'build'|'info'|'objects'|'styleboards'|'finishes'|'exports'|'help' = 'project';
  viewPort: '2d'|'3d' = '2d';
  units: 'm'|'ft' = 'm';
  lockConstruction = false;
  lockLabels = false;
  lockFurniture = false;
  angleSnap = true;
  readonly defaultViewBox = { minX: -1000, minY: -800, width: 2000, height: 1600 };
  private readonly defaultGridSpacing = 100;
  private readonly defaultGridMajorEvery = 5;
  private readonly defaultGridOpacity = 0.35;

  // Drawing state
  mode: 'select'|'pan'|'wall'|'room'|'door'|'window'|'measure' = 'select';
  creating = false;
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
  selectedWallPoint: Point | null = null;
  selectedWallT: number | null = null;
  selectedRoomId: string | null = null;
  dragging: null
    | { kind: 'wall-node'; anchors: WallDragAnchor[] }
    | { kind: 'room-corner'; roomId: string; corner: 'nw'|'ne'|'sw'|'se' } = null;
  // tool properties
  wallThickness = 200; // mm world units
  wallHeight = 3000;   // mm
  openingWidth = 900;  // mm
  lengthDelta = 200;

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
  private cam = { yaw: 0, pitch: -0.6, distance: 4500 };

  private qpSub?: Subscription;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  measureStart: Point | null = null;
  measureDraft: Point | null = null;
  measurements: MeasurementSegment[] = [];

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
  }
  toggleTheme() { this.setTheme(this.isDark ? 'light' : 'dark'); }
  private setTheme(mode: 'light' | 'dark') {
    this.isDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', mode === 'dark');
    try { localStorage.setItem('theme', mode); } catch {}
  }

  viewBox() { return `${this.minX} ${this.minY} ${this.width} ${this.height}`; }
  clearAll(){
    this.walls=[];
    this.rooms=[];
    this.creating=false;
    this.draftA=null;
    this.draftB=null;
    this.wallPath=[];
    this.selectedWallId=null;
    this.selectedWallPoint=null;
    this.selectedWallT=null;
    this.selectedRoomId=null;
    this.dragging=null;
  }

  // Pointer events
  onSvgClick(e: MouseEvent){
    const raw = this.toWorld(e);
    if(this.mode==='measure'){
      const point = this.resolveGenericPoint(raw);
      if(!this.measureStart){
        this.measureStart = { ...point };
        this.measureDraft = { ...point };
        this.setSaveState('idle', 'Select a second point to measure distance.');
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
      }
      return;
    }
    if(this.mode==='select'){
      const p = this.resolveGenericPoint(raw);
      const hit = this.pickWallAtPoint(p, 30);
      if(hit){
        this.selectedWallId = hit.wall.id;
        this.selectedWallT = hit.t;
        this.selectedWallPoint = hit.proj;
        this.selectedRoomId = null;
        this.setSaveState('idle', `Wall length: ${this.formatLength(this.segLen(hit.wall.a, hit.wall.b))}`);
      } else {
        this.selectedWallId = null;
        this.selectedWallPoint = null;
        this.selectedWallT = null;
        this.setSaveState('idle', 'Select a wall or switch tools to keep drafting.');
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
      } else {
        this.addWallSegment(p);
      }
      return;
    }
    if(this.mode==='room'){
      const p = this.resolveGenericPoint(raw);
      if(!this.creating){
        const start = { ...p };
        this.creating = true;
        this.draftA = start;
        this.draftB = start;
      } else {
        this.draftB = { ...p };
        this.finishRoomDrawing();
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
    const p = this.resolveGenericPoint(this.toWorld(e));
    // if select, attempt to start dragging handle
    if(this.mode==='select'){
      const h = this.hitHandle(p);
      if(h){ this.dragging = h; return; }
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
    if(this.mode==='measure'){
      if(this.measureStart){
        this.measureDraft = this.resolveGenericPoint(raw);
      }
      return;
    }
    if(this.creating){
      if(this.mode==='wall'){
        this.draftB = this.resolveWallPoint(raw);
        return;
      }
      if(this.mode==='room'){
        this.draftB = this.resolveGenericPoint(raw);
        return;
      }
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
        this.updateSelectedWallPoint();
      } else if(this.dragging.kind==='room-corner'){
        const d = this.dragging;
        const r = this.rooms.find(x=>x.id===d.roomId)!;
        const x2 = (d.corner==='ne' || d.corner==='se') ? p.x : r.x;
        const y2 = (d.corner==='sw' || d.corner==='se') ? p.y : r.y;
        const x1 = (d.corner==='ne' || d.corner==='se') ? r.x : p.x;
        const y1 = (d.corner==='sw' || d.corner==='se') ? r.y : p.y;
        r.x = Math.min(x1,x2); r.y = Math.min(y1,y2); r.w = Math.abs(x2-x1); r.h = Math.abs(y2-y1);
      }
      return;
    }
  }
  onMouseUp(){
    if(this.panning){ this.panning = false; }
    this.dragging = null;
  }
  @HostListener('window:mouseup') winUp(){ this.panning=false; this.dragging=null; }
  @HostListener('window:keydown.escape') cancelGesture(){
    if(this.mode==='measure'){
      if(this.measureStart){
        this.measureStart = null;
        this.measureDraft = null;
        this.setSaveState('idle', 'Measurement cancelled.');
      } else {
        this.toggleMeasureMode(false);
      }
      this.dragging = null;
      return;
    }
    if(this.creating){
      if(this.mode==='wall'){ this.finishWallDrawing(); }
      else if(this.mode==='room'){ this.creating=false; this.draftA=null; this.draftB=null; }
    }
    this.dragging = null;
  }
  onWheel(e: WheelEvent){ e.preventDefault(); const factor = e.deltaY < 0 ? 1/1.1 : 1.1; this.zoom(factor); }
  zoom(f: number){ const cx = this.minX + this.width/2; const cy = this.minY + this.height/2; this.width *= f; this.height *= f; this.minX = cx - this.width/2; this.minY = cy - this.height/2; this.scale = 2000 / this.width; }
  resetView(){
    this.minX = this.defaultViewBox.minX;
    this.minY = this.defaultViewBox.minY;
    this.width = this.defaultViewBox.width;
    this.height = this.defaultViewBox.height;
    this.scale = 1;
  }
  fitToContent(): void {
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
    if (points.length === 0) {
      this.resetView();
      return;
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      if (p.x < minX) { minX = p.x; }
      if (p.y < minY) { minY = p.y; }
      if (p.x > maxX) { maxX = p.x; }
      if (p.y > maxY) { maxY = p.y; }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      this.resetView();
      return;
    }
    const padding = Math.max(this.gridSpacing * 2, 200);
    const width = Math.max(maxX - minX, 400);
    const height = Math.max(maxY - minY, 400);
    this.minX = minX - padding;
    this.minY = minY - padding;
    this.width = width + padding * 2;
    this.height = height + padding * 2;
    this.scale = 2000 / this.width;
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

  private finishWallDrawing(): void {
    this.creating = false;
    this.draftA = null;
    this.draftB = null;
    this.wallPath = [];
  }

  private finishRoomDrawing(): void {
    if(!this.draftA || !this.draftB){ return; }
    const x = Math.min(this.draftA.x, this.draftB.x);
    const y = Math.min(this.draftA.y, this.draftB.y);
    const w = Math.abs(this.draftA.x - this.draftB.x);
    const h = Math.abs(this.draftA.y - this.draftB.y);
    if(w>0 && h>0){
      this.rooms.push({ id:this.uid(), x, y, w, h, height:3000 });
    }
    this.creating = false;
    this.draftA = null;
    this.draftB = null;
  }

  private addWallSegment(target: Point): void {
    if(!this.draftA){ return; }
    const resolved = this.resolveWallPoint(target);
    if(this.samePoint(this.draftA, resolved)){ return; }
    const base: Wall = { id:this.uid(), a:this.draftA, b:resolved, thickness:this.wallThickness, height:this.wallHeight, openings:[] };
    const newSegs = this.splitAgainstAllWalls(base);
    if(newSegs.length === 0){ return; }
    this.walls.push(...newSegs);
    const tail = newSegs[newSegs.length-1].b;
    this.wallPath.push(tail);
    this.draftA = tail;
    this.draftB = tail;
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

  private resolveWallPoint(raw: Point): Point {
    const origin = this.wallPath.length > 0 ? this.wallPath[this.wallPath.length - 1] : this.draftA;
    let point = { ...raw };
    const snappedExisting = this.snapToExistingNode(point);
    if (snappedExisting) {
      return snappedExisting;
    }
    if (origin && this.angleSnap) {
      point = this.applyAngleSnap(origin, point);
    }
    if (this.snap && (!origin || !this.angleSnap)) {
      point = this.snapPoint(point);
    }
    const after = this.snapToExistingNode(point);
    return after ?? point;
  }

  private resolveGenericPoint(raw: Point): Point {
    let point = { ...raw };
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
  private uid(){ return Math.random().toString(36).slice(2,9); }
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
  get selectedWall(): Wall | null {
    if(!this.selectedWallId) return null;
    return this.walls.find(w=>w.id===this.selectedWallId) ?? null;
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
    if(!this.selectedWallId || this.selectedWallT===null){ this.selectedWallPoint=null; return; }
    const wall = this.selectedWall;
    if(!wall){ this.selectedWallPoint=null; this.selectedWallId=null; return; }
    const t = Math.max(0, Math.min(1, this.selectedWallT));
    this.selectedWallPoint = {
      x: wall.a.x + (wall.b.x - wall.a.x) * t,
      y: wall.a.y + (wall.b.y - wall.a.y) * t
    };
  }
  private moveWallNode(point: Point, to: Point){
    const targetKey = this.pointKey(point);
    const nodes = this.wallNodeIndex();
    const entry = nodes.find(n=>this.pointKey(n.point)===targetKey);
    if(entry){
      entry.anchors.forEach(anchor=>{
        anchor.point.x = to.x;
        anchor.point.y = to.y;
        anchor.wall[anchor.end] = anchor.point;
      });
    } else {
      point.x = to.x;
      point.y = to.y;
    }
  }
  private replaceWallWithSegments(originalId: string, segments: Wall[]){
    const idx = this.walls.findIndex(w=>w.id===originalId);
    if(idx===-1) return;
    this.walls.splice(idx, 1, ...segments);
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
    this.selectedWallId = nextSegment.id;
    this.selectedWallT = segments[1] ? 0 : 1;
    this.selectedWallPoint = { x: junction.x, y: junction.y };
    this.updateSelectedWallPoint();
    return { point: junction, created: true };
  }
  private intersect(a1:Point,a2:Point,b1:Point,b2:Point){
    const dax=a2.x-a1.x, day=a2.y-a1.y, dbx=b2.x-b1.x, dby=b2.y-b1.y;
    const denom = dax*dby - day*dbx;
    if(Math.abs(denom)<1e-6) return null; // parallel or colinear -> ignore
    const s = ((a1.x-b1.x)*dby - (a1.y-b1.y)*dbx)/denom;
    const t = ((a1.x-b1.x)*day - (a1.y-b1.y)*dax)/denom;
    if(s>0 && s<1 && t>0 && t<1){
      return { point: { x: a1.x + s*dax, y: a1.y + s*day }, s, t };
    }
    return null;
  }
  private splitWallAtPoints(w:Wall, params:number[]):Wall[]{
    if(params.length===0) return [w];
    const sorted=[...params].sort((a,b)=>a-b);
    const parts:Wall[]=[];
    let lastA=w.a;
    for(const t of sorted){
      const mid={ x: w.a.x + (w.b.x-w.a.x)*t, y: w.a.y + (w.b.y-w.a.y)*t };
      parts.push({ id:this.uid(), a:lastA, b:mid, thickness:w.thickness, height:w.height, openings:[] });
      lastA = mid;
    }
    parts.push({ id:this.uid(), a:lastA, b:w.b, thickness:w.thickness, height:w.height, openings:[] });
    return parts;
  }
  private splitAgainstAllWalls(newWall:Wall):Wall[]{
    // gather intersection params for new wall and split existing walls as needed
    const cutsNew:number[]=[]; const updates: { idx:number; cuts:number[] }[]=[];
    this.walls.forEach((w,idx)=>{
      const hit = this.intersect(newWall.a,newWall.b,w.a,w.b);
      if(hit){ cutsNew.push(hit.s); updates.push({ idx, cuts:[hit.t] }); }
    });
    // apply splits on existing walls
    const produced:Wall[]=[]; const survivors:Wall[]=[];
    this.walls.forEach((w,idx)=>{
      const upd = updates.find(u=>u.idx===idx);
      if(upd){ produced.push(...this.splitWallAtPoints(w, upd.cuts)); }
      else survivors.push(w);
    });
    this.walls = survivors.concat(produced);
    // split new wall and return segments
    return this.splitWallAtPoints(newWall, cutsNew);
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
      }
    };
  }

  private loadModel(m:any){
    this.clearAll();
    this.resetGridSettings();
    this.measurements = [];
    this.measureStart = null;
    this.measureDraft = null;
    this.walls=m?.walls||[];
    this.rooms=m?.rooms||[];
    const v=m?.view||{};
    this.minX=v.minX??this.minX;
    this.minY=v.minY??this.minY;
    this.width=v.width??this.width;
    this.height=v.height??this.height;
    const g = m?.grid || {};
    this.updateGridSpacing(g.spacing ?? this.gridSpacing);
    this.updateGridMajorEvery(g.majorEvery ?? this.gridMajorEvery);
    this.updateGridOpacity(g.opacity ?? this.gridOpacity);
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
  draftRoomBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (!(this.creating && this.mode === 'room' && this.draftA && this.draftB)) {
      return null;
    }
    return {
      minX: Math.min(this.draftA.x, this.draftB.x),
      minY: Math.min(this.draftA.y, this.draftB.y),
      maxX: Math.max(this.draftA.x, this.draftB.x),
      maxY: Math.max(this.draftA.y, this.draftB.y)
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
    const result = this.ensureNodeAtSelection();
    if (!result) return;
    if (result.created) {
      this.setSaveState('idle', 'Wall split created. Drag the new handle or branch from here.');
    } else {
      this.setSaveState('idle', 'Select a point along the wall to split.');
    }
  }

  curveSelectedWall(): void {
    this.ensureNodeAtSelection();
    const wall = this.selectedWall;
    if (!wall) return;
    const length = this.segLen(wall.a, wall.b);
    if (length < 150) {
      this.setSaveState('idle', 'Wall too short to curve.');
      return;
    }
    const segments = this.splitWallAtPoints(wall, [0.5]);
    this.replaceWallWithSegments(wall.id, segments);
    const pivot = segments[0].b;
    this.selectedWallId = segments[0].id;
    this.selectedWallT = 1;
    this.selectedWallPoint = { x: pivot.x, y: pivot.y };
    this.updateSelectedWallPoint();
    this.setSaveState('idle', 'Midpoint added. Drag handles to shape a curve.');
  }

  branchFromSelectedWall(): void {
    const result = this.ensureNodeAtSelection();
    if (!result) return;
    const start = result.point;
    this.toolset = 'build';
    this.mode = 'wall';
    this.creating = true;
    this.wallPath = [start];
    this.draftA = start;
    this.draftB = start;
    this.selectedWallId = null;
    this.selectedWallPoint = null;
    this.selectedWallT = null;
    this.setSaveState('idle', 'Branching wall: click to add the next point.');
  }

  deleteSelectedWall(): void {
    if (!this.selectedWallId) return;
    this.walls = this.walls.filter(w => w.id !== this.selectedWallId);
    this.selectedWallId = null;
    this.selectedWallPoint = null;
    this.selectedWallT = null;
    this.setSaveState('idle', 'Wall removed.');
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
  }

  clearMeasurements(): void {
    if (this.measurements.length === 0) {
      return;
    }
    this.measurements = [];
    this.setSaveState('idle', 'Measurements cleared.');
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
