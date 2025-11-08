First base UI should have the viewport cover the whole page.
The left side bar should be a floating utility widget
The right side bar should be viewport tools
The general ui should look like this

```html
<div #main class="h-screen w-screen overflow-hidden">
    <div #header class="h-[70px] w-screen overflow-hidden"></div>
    <div #viewportArea class="relative h-[calc(100vh-70px)] w-screen overflow-hidden">
        <div #leftSideBar class="absolute top-5 left-5 h-[calc(100vh-130px)] w-auto overflow- flex items-start justify-start gap-3">
            <div #toolsIcons class="h-full w-[50px] bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex-flex-col items-start justify-center gap-3 shadow-lg">
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'project'" >Project</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'build'" >Build</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'info'" >Info</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'objects'" >Objects</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'styleboards'" >Styleboards</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'finishes'" >Finishes</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'exports'" >Exports</div>
                <div class="active:bg-blue-400 hover:text-slate-50" (click)="toolset = 'help'" >Help</div>
            </div>
            <div #toolSet class="h-auto max-h-full w-[300px] overflow-hidden bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex-flex-col items-start justify-center gap-3 shadow-lg">
                <div *ngIf="toolset === 'project'" >
                Project tools like floor selector, add floor, floor name, floor plan preview, active design indicator, edit details, design history, transform design to move floor plan on z plane or flip it or rotate it, or change pivot point, items in design, light settings, diplicate and delete 
                </div>
                <div *ngIf="toolset === 'build'" >
                Build tools like upload 2d floor plan, draw room (essentially drag cursor to draw a box and change thicknes, wall height and raise from floor value), draw wall (click and drag to draw a line that has points at each end that can be clicked and dragged to change wall length and angle and has a floating panel to change length manually with more finer numbers and choose direction to grow or shrink wall like both side, left/up or right/down with clear icons) and when you draw a wall that cuts through another wall the intersection actually cuts the walls to produce 4 separate walls, draw surface, place doors and windows that actually cut hole space through the walls you place them on, place structures
                </div>
                <div *ngIf="toolset === 'info'" >
                Info tools like set room type, place label, place signs and symbols, draw line, draw dimension
                </div>
                <div *ngIf="toolset === 'objects'" >
                Objects tools like browser object catalogs and drag and drop the objects into place like chairs beds etc.
                </div>
                <div *ngIf="toolset === 'styleboards'" >
                Styleboards tools to choose the architectural style and interior/exterior theme
                </div>
                <div *ngIf="toolset === 'finishes'" >
                Finishes tools like colors and materials
                </div>
                <div *ngIf="toolset === 'exports'" >
                Exports tools like 2d export, 3d export
                </div>
                <div *ngIf="toolset === 'help'" >
                Help tools like keyboard shortcuts
                </div>
            </div>
            <div #toolSet class="h-auto w-[30px] overflow-hidden bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex-flex-col items-start justify-center gap-3 shadow-lg">
                <div>Zoom in</div>
                <div>Zoom out</div>
                <div>Reset zoom</div>
            </div>
        </div>
        <div #extraShortcuts class="absolute bottom-5 left-5 h-40px w-auto overflow-hidden bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex items-start justify-center gap-3 shadow-lg">
            <div>Units meters|feet</div>
            <div>Measure distance</div>
            <div>Lock construction</div>
            <div>Lock labels & lines</div>
            <div>Lock furniture</div>
        </div>
        <div #actualViewPort class="-z-1 h-screen w-screen overflow-hidden">
            <div *ngIf="viewPort === '2d' else 3dViewPort" #2dViewPort class="h-full w-full overflow-hidden"></div>
            <div #3dViewPort class="h-full w-full overflow-hidden"></div>
        </div>
        <div #rightSidebar class="absolute top-5 right-5 flex items-start justify-start max-h-screen w-auto overflow-hidden">
            <div *ngIf="viewPort === '2d'" #2dSettings class="h-auto w-auto overflow-hidden bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex items-start justify-center gap-3 shadow-lg">
                <div>Grayscale</div>
                <div>Colored</div>
                <div>Color picker</div>
                <div>Settings that displays dropdown for settings like general settings eg show grid, symbols, blueprint mode, show camers, sync camers, show north arrow, image smoothing, hide all, structure & furnitures settings, lighting settings, text settings, dimensions settings, debug menu</div>
            </div>
            <div *ngIf="viewPort === '3d'" #3dSettings class="h-auto w-auto overflow-hidden bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex items-start justify-center gap-3 shadow-lg">
                <div>Top</div>
                <div>Perspective</div>
                <div>3d view settings like show cut section, show camera frame, zoom camera, sync cameras on floor, show doors, show fixtures, show furnitures, cutaways walls, show floors below, show cielings, show shadows, image smoothing</div>
            </div>
            <div #viewPortPicker class="h-auto w-[30px] overflow-hidden bg-blue-50 dark:bg-blue-900 p-2 rounded-lg overflow-x-hidden overflow-y-auto flex items-start justify-center gap-3 shadow-lg">
                <div>2d</div>
                <div>3d</div>
            </div>
        </div>
    </div>
</div>

In the toolset, in 3d view there only camera that shows toolset for camera like camera type (perspective, or top view, or left, front back right etc ), field of vew and camera height
```

A floating ai helper and chat that uses berjis Ai will be more than useful for the user at the bottom right
3d view should reflect 2d plan