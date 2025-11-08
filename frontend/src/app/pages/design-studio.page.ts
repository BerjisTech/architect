import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StudioService } from '../services/studio.service';

type Point = { x: number; y: number };
type Opening = { id: string; kind: 'door'|'window'; offset: number; width: number };
type Wall = { id: string; a: Point; b: Point; thickness: number; height: number; openings: Opening[] };
type Room = { id: string; x: number; y: number; w: number; h: number; height: number };

@Component({
  selector: 'arch-design-studio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './design-studio.page.html'
})
export class DesignStudioPage implements OnInit {
  @ViewChild('pane', { static: true }) pane!: ElementRef<HTMLDivElement>;

  // UI state
  toolset: 'project'|'build'|'info'|'objects'|'styleboards'|'finishes'|'exports'|'help' = 'project';
  viewPort: '2d'|'3d' = '2d';
  units: 'm'|'ft' = 'm';
  lockConstruction = false;
  lockLabels = false;
  lockFurniture = false;

  // Drawing state
  mode: 'select'|'pan'|'wall'|'room'|'door'|'window' = 'select';
  creating = false;
  // world objects
  walls: Wall[] = [];
  rooms: Room[] = [];
  // temp preview
  draftA: Point | null = null; // for wall start or room start
  draftB: Point | null = null; // current cursor position in drag
  // selection/dragging
  selectedWallId: string | null = null;
  selectedRoomId: string | null = null;
  dragging: null | { kind: 'wall-end'; wallId: string; end: 'a'|'b' } | { kind: 'room-corner'; roomId: string; corner: 'nw'|'ne'|'sw'|'se' } = null;
  // tool properties
  wallThickness = 200; // mm world units
  wallHeight = 3000;   // mm
  openingWidth = 900;  // mm

  // Viewport (world units)
  minX = -1000; minY = -800; width = 2000; height = 1600;
  scale = 1; // 1 == 1:1 world units

  private panning = false;
  private panStart = { x: 0, y: 0 };
  private viewStart = { minX: 0, minY: 0 };
  snap = true;
  name = '';
  loadId = '';
  lastSaved = '';
  error = '';

  title = 'Architect';
  isDark = false;
  ngOnInit(): void {
    const persisted = (localStorage.getItem('theme') || '').toLowerCase();
    const preferDark = persisted === 'dark';
    this.setTheme(preferDark ? 'dark' : 'light');
  }
  toggleTheme() { this.setTheme(this.isDark ? 'light' : 'dark'); }
  private setTheme(mode: 'light' | 'dark') {
    this.isDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', mode === 'dark');
    try { localStorage.setItem('theme', mode); } catch {}
  }

  viewBox() { return `${this.minX} ${this.minY} ${this.width} ${this.height}`; }
  clearAll(){ this.walls=[]; this.rooms=[]; this.creating=false; this.draftA=null; this.draftB=null; this.selectedWallId=null; this.selectedRoomId=null; }

  // Pointer events
  onSvgClick(e: MouseEvent){
    const pRaw = this.toWorld(e);
    const p = this.snap ? this.snapPoint(pRaw) : pRaw;
    // click-to-click mode for wall/room
    if(this.mode==='wall' || this.mode==='room'){
      if(!this.creating){ this.creating=true; this.draftA=p; this.draftB=p; return; }
      // second click finishes
      this.draftB = p; this.onMouseUp(); return;
    }
    // placing doors/windows with single click
    if(this.mode==='door' || this.mode==='window'){
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
  onMouseDown(e: MouseEvent){
    // handle pan first
    if(this.mode==='pan'){
      this.panning = true; this.panStart = { x: e.clientX, y: e.clientY }; this.viewStart = { minX: this.minX, minY: this.minY }; return;
    }
    const p = this.snap ? this.snapPoint(this.toWorld(e)) : this.toWorld(e);
    // if select, attempt to start dragging handle
    if(this.mode==='select'){
      const h = this.hitHandle(p);
      if(h){ this.dragging = h as any; return; }
    }
    // start wall or room drag
    if(this.mode==='wall' || this.mode==='room'){
      this.creating = true; this.draftA = p; this.draftB = p; return;
    }
  }
  onMouseMove(e: MouseEvent){
    if(this.panning){ const dx = e.clientX - this.panStart.x; const dy = e.clientY - this.panStart.y; const el = this.pane.nativeElement; const pxToWorldX = this.width / el.clientWidth; const pxToWorldY = this.height / el.clientHeight; this.minX = this.viewStart.minX - dx * pxToWorldX; this.minY = this.viewStart.minY - dy * pxToWorldY; return; }
    const p = this.snap ? this.snapPoint(this.toWorld(e)) : this.toWorld(e);
    if(this.creating && (this.mode==='wall' || this.mode==='room')){ this.draftB = p; return; }
    // dragging handles
    if(this.dragging){
      if(this.dragging.kind==='wall-end'){
        const d:any = this.dragging;
        const w = this.walls.find(x=>x.id===d.wallId)!;
        if(d.end==='a') w.a = p; else w.b = p;
      } else if(this.dragging.kind==='room-corner'){
        const d:any = this.dragging;
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
    if(this.panning){ this.panning = false; return; }
    if(this.creating){
      if(this.mode==='wall' && this.draftA && this.draftB){
        const newSegs = this.splitAgainstAllWalls({ id:this.uid(), a:this.draftA, b:this.draftB, thickness:this.wallThickness, height:this.wallHeight, openings:[] });
        // add produced segments (already split)
        this.walls.push(...newSegs);
      } else if(this.mode==='room' && this.draftA && this.draftB){
        const x = Math.min(this.draftA.x, this.draftB.x);
        const y = Math.min(this.draftA.y, this.draftB.y);
        const w = Math.abs(this.draftA.x - this.draftB.x);
        const h = Math.abs(this.draftA.y - this.draftB.y);
        if(w>0 && h>0) this.rooms.push({ id:this.uid(), x, y, w, h, height:3000 });
      }
      this.creating = false; this.draftA=null; this.draftB=null;
    }
    this.dragging = null;
  }
  @HostListener('window:mouseup') winUp(){ this.panning=false; }
  onWheel(e: WheelEvent){ e.preventDefault(); const factor = e.deltaY < 0 ? 1/1.1 : 1.1; this.zoom(factor); }
  zoom(f: number){ const cx = this.minX + this.width/2; const cy = this.minY + this.height/2; this.width *= f; this.height *= f; this.minX = cx - this.width/2; this.minY = cy - this.height/2; this.scale = 2000 / this.width; }
  resetView(){ this.minX=-1000; this.minY=-800; this.width=2000; this.height=1600; this.scale=1; }

  private toWorld(e: MouseEvent): Point { const el = this.pane.nativeElement; const rect = el.getBoundingClientRect(); const px = e.clientX - rect.left; const py = e.clientY - rect.top; const x = this.minX + (px / rect.width) * this.width; const y = this.minY + (py / rect.height) * this.height; return { x: Math.round(x), y: Math.round(y) }; }
  private snapPoint(p: Point): Point { const g = 50; return { x: Math.round(p.x/g)*g, y: Math.round(p.y/g)*g }; }
  // geometry helpers
  private segLen(a:Point,b:Point){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }
  private uid(){ return Math.random().toString(36).slice(2,9); }
  private pickWallAtPoint(p:Point, thresh=30){
    let best: { wall: Wall; t:number; dist:number }|null=null;
    for(const w of this.walls){
      const {t, dist} = this.pointSegDistanceParam(p, w.a, w.b);
      const eff = Math.max(thresh, w.thickness/2);
      if(dist<=eff && t>=0 && t<=1){ if(!best || dist<best.dist) best={ wall:w, t, dist}; }
    }
    return best;
  }
  private pointSegDistanceParam(p:Point, a:Point, b:Point){
    const vx=b.x-a.x, vy=b.y-a.y; const len2 = vx*vx+vy*vy || 1; const t = ((p.x-a.x)*vx + (p.y-a.y)*vy)/len2; const tt = Math.max(0,Math.min(1,t)); const proj = { x:a.x+tt*vx, y:a.y+tt*vy }; const dx=p.x-proj.x, dy=p.y-proj.y; return { t:tt, dist: Math.hypot(dx,dy), proj };
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
    const parts:Wall[]=[]; let prev=0; let lastA=w.a;
    for(const t of sorted){
      const mid={ x: w.a.x + (w.b.x-w.a.x)*t, y: w.a.y + (w.b.y-w.a.y)*t };
      parts.push({ id:this.uid(), a:lastA, b:mid, thickness:w.thickness, height:w.height, openings:[] });
      lastA = mid; prev = t;
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
  private hitHandle(p:Point){
    // wall endpoints
    for(const w of this.walls){
      if(this.dist(p,w.a)<20) return { kind:'wall-end', wallId:w.id, end:'a' as const };
      if(this.dist(p,w.b)<20) return { kind:'wall-end', wallId:w.id, end:'b' as const };
    }
    // room corners
    for(const r of this.rooms){
      const pts=[ {pt:{x:r.x,y:r.y},name:'nw'}, {pt:{x:r.x+r.w,y:r.y},name:'ne'}, {pt:{x:r.x,y:r.y+r.h},name:'sw'}, {pt:{x:r.x+r.w,y:r.y+r.h},name:'se'} ] as const;
      for(const c of pts){ if(this.dist(p,c.pt)<20) return { kind:'room-corner', roomId:r.id, corner:c.name } as const; }
    }
    return null;
  }
  private dist(a:Point,b:Point){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }

  constructor(private studio: StudioService) {}
  private serialize(){ return { walls:this.walls, rooms:this.rooms, view:{minX:this.minX,minY:this.minY,width:this.width,height:this.height} }; }
  private loadModel(m:any){ this.walls=m?.walls||[]; this.rooms=m?.rooms||[]; const v=m?.view||{}; this.minX=v.minX??this.minX; this.minY=v.minY??this.minY; this.width=v.width??this.width; this.height=v.height??this.height; }
  async save(){ try{ this.error=''; if(!this.name) return; if(!this.loadId){ const id=await this.studio.create(this.name,this.serialize()); this.loadId=id; } else { await this.studio.update(this.loadId,{ name:this.name, data:this.serialize() }); } this.lastSaved=new Date().toLocaleTimeString(); }catch(e:any){ this.error=e?.message||'save failed'; } }
  async loadById(){ try{ this.error=''; if(!this.loadId) return; const fp=await this.studio.get(this.loadId); this.name=fp.name||this.name; this.loadModel(fp.data); }catch(e:any){ this.error=e?.message||'load failed'; } }
}
