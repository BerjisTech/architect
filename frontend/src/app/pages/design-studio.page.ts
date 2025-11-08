import { Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StudioService } from '../services/studio.service';

type Point = { x: number; y: number };

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
  mode: 'select'|'pan'|'wall' = 'select';
  creating = false;
  walls: { points: Point[] }[] = [];
  current: Point[] = [];

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
  pointsAttr(pts: Point[]) { return pts.map(p => `${p.x},${p.y}`).join(' '); }
  startWall(){ this.mode='wall'; this.creating = true; this.current = []; }
  finishWall(){ if(this.current.length>1){ this.walls.push({ points: [...this.current] }); } this.creating=false; this.current=[]; }
  clearAll(){ this.walls=[]; this.current=[]; this.creating=false; }

  onSvgClick(e: MouseEvent){ if(this.mode !== 'wall') return; const p = this.toWorld(e); this.current.push(this.snap ? this.snapPoint(p) : p); }
  onMouseDown(e: MouseEvent){ if(this.mode !== 'pan') return; this.panning = true; this.panStart = { x: e.clientX, y: e.clientY }; this.viewStart = { minX: this.minX, minY: this.minY }; }
  onMouseMove(e: MouseEvent){ if(!this.panning) return; const dx = e.clientX - this.panStart.x; const dy = e.clientY - this.panStart.y; const el = this.pane.nativeElement; const pxToWorldX = this.width / el.clientWidth; const pxToWorldY = this.height / el.clientHeight; this.minX = this.viewStart.minX - dx * pxToWorldX; this.minY = this.viewStart.minY - dy * pxToWorldY; }
  onMouseUp(){ this.panning = false; }
  @HostListener('window:mouseup') winUp(){ this.panning=false; }
  onWheel(e: WheelEvent){ e.preventDefault(); const factor = e.deltaY < 0 ? 1/1.1 : 1.1; this.zoom(factor); }
  zoom(f: number){ const cx = this.minX + this.width/2; const cy = this.minY + this.height/2; this.width *= f; this.height *= f; this.minX = cx - this.width/2; this.minY = cy - this.height/2; this.scale = 2000 / this.width; }
  resetView(){ this.minX=-1000; this.minY=-800; this.width=2000; this.height=1600; this.scale=1; }

  private toWorld(e: MouseEvent): Point { const el = this.pane.nativeElement; const rect = el.getBoundingClientRect(); const px = e.clientX - rect.left; const py = e.clientY - rect.top; const x = this.minX + (px / rect.width) * this.width; const y = this.minY + (py / rect.height) * this.height; return { x: Math.round(x), y: Math.round(y) }; }
  private snapPoint(p: Point): Point { const g = 50; return { x: Math.round(p.x/g)*g, y: Math.round(p.y/g)*g }; }
  lastSegmentLength(): number { if(this.current.length<2) return 0; const a=this.current[this.current.length-2], b=this.current[this.current.length-1]; const dx=b.x-a.x, dy=b.y-a.y; return Math.round(Math.sqrt(dx*dx+dy*dy)); }

  constructor(private studio: StudioService) {}
  private serialize(){ return { walls:this.walls, current:this.current, view:{minX:this.minX,minY:this.minY,width:this.width,height:this.height} }; }
  private loadModel(m:any){ this.walls=m?.walls||[]; this.current=m?.current||[]; const v=m?.view||{}; this.minX=v.minX??this.minX; this.minY=v.minY??this.minY; this.width=v.width??this.width; this.height=v.height??this.height; }
  async save(){ try{ this.error=''; if(!this.name) return; if(!this.loadId){ const id=await this.studio.create(this.name,this.serialize()); this.loadId=id; } else { await this.studio.update(this.loadId,{ name:this.name, data:this.serialize() }); } this.lastSaved=new Date().toLocaleTimeString(); }catch(e:any){ this.error=e?.message||'save failed'; } }
  async loadById(){ try{ this.error=''; if(!this.loadId) return; const fp=await this.studio.get(this.loadId); this.name=fp.name||this.name; this.loadModel(fp.data); }catch(e:any){ this.error=e?.message||'load failed'; } }
}
