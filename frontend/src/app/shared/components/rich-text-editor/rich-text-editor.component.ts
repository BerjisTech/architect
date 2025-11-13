import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  ViewChild,
  forwardRef,
  inject
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './rich-text-editor.component.html',
  styleUrls: ['./rich-text-editor.component.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit {
  @Input() placeholder = 'Describe your service offering...';
  @Input() ariaLabel = 'Service description';
  @ViewChild('editor', { static: true }) private editorRef!: ElementRef<HTMLDivElement>;

  value = '';
  disabled = false;
  isFocused = false;

  private pendingValue: string | null = '';
  private readonly cdr = inject(ChangeDetectorRef);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngAfterViewInit(): void {
    if (this.pendingValue !== null) {
      this.setEditorHtml(this.pendingValue);
      this.pendingValue = null;
    }
  }

  writeValue(value: string | null): void {
    const sanitized = this.sanitizeHtml(value ?? '');
    this.value = sanitized;
    if (this.editorRef) {
      this.setEditorHtml(sanitized);
    } else {
      this.pendingValue = sanitized;
    }
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    if (this.editorRef) {
      this.editorRef.nativeElement.setAttribute('contenteditable', (!isDisabled).toString());
    }
    this.cdr.markForCheck();
  }

  handleInput(): void {
    this.emitValue();
  }

  handleFocus(): void {
    this.isFocused = true;
    this.cdr.markForCheck();
  }

  handleBlur(): void {
    this.isFocused = false;
    this.onTouched();
    this.cdr.markForCheck();
  }

  handlePaste(event: ClipboardEvent): void {
    if (!event.clipboardData) {
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      document.execCommand('insertText', false, text);
      this.emitValue();
    }
  }

  exec(command: string, value?: string): void {
    if (this.disabled) {
      return;
    }
    document.execCommand(command, false, value ?? undefined);
    this.emitValue();
  }

  formatBlock(tag: 'P' | 'H2' | 'H3' | 'BLOCKQUOTE'): void {
    if (this.disabled) {
      return;
    }
    document.execCommand('formatBlock', false, tag);
    this.emitValue();
  }

  insertLink(): void {
    if (this.disabled) {
      return;
    }
    const url = window.prompt('Enter link URL');
    if (!url) {
      return;
    }
    document.execCommand('createLink', false, url.trim());
    this.emitValue();
  }

  clearFormatting(): void {
    if (this.disabled) {
      return;
    }
    document.execCommand('removeFormat', false);
    document.execCommand('unlink', false);
    this.emitValue();
  }

  private emitValue(): void {
    const editorEl = this.editorRef.nativeElement;
    const sanitized = this.sanitizeHtml(editorEl.innerHTML);
    this.value = sanitized;
    this.setEditorHtml(sanitized);
    this.onChange(sanitized);
    this.cdr.markForCheck();
  }

  private setEditorHtml(html: string): void {
    this.editorRef.nativeElement.innerHTML = html;
  }

  private sanitizeHtml(raw: string): string {
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined' || typeof document === 'undefined') {
      return raw ?? '';
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${raw ?? ''}</div>`, 'text/html');
    const container = (doc.body.firstElementChild as HTMLElement) ?? doc.createElement('div');
    const allowedTags = new Set(['div', 'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'a', 'blockquote', 'h2', 'h3', 'span']);

    const walk = (node: Node): void => {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        walk(child);
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
          this.unwrapElement(el);
          return;
        }
        const attributes = Array.from(el.attributes);
        for (const attr of attributes) {
          const name = attr.name.toLowerCase();
          if (tag === 'a' && name === 'href') {
            if (!this.isSafeUrl(attr.value)) {
              el.removeAttribute(attr.name);
            } else {
              el.setAttribute('rel', 'noopener noreferrer');
              el.setAttribute('target', '_blank');
            }
            continue;
          }
          if (tag === 'a' && (name === 'target' || name === 'rel')) {
            continue;
          }
          if (name === 'style' || name.startsWith('on') || name.startsWith('data-')) {
            el.removeAttribute(attr.name);
            continue;
          }
          if (tag !== 'a') {
            el.removeAttribute(attr.name);
          }
        }
        if (tag === 'span' && el.attributes.length === 0) {
          this.unwrapElement(el);
        }
      }
    };

    walk(container);

    const normalized = container.innerHTML.replace(/\u00a0/g, ' ').trim();
    if (!normalized) {
      return '';
    }
    const probe = document.createElement('div');
    probe.innerHTML = normalized;
    if ((probe.textContent ?? '').replace(/\s+/g, '').length === 0) {
      return '';
    }
    return normalized;
  }

  private unwrapElement(element: HTMLElement): void {
    const parent = element.parentNode;
    if (!parent) {
      return;
    }
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
  }

  private isSafeUrl(url: string | null): boolean {
    if (!url) {
      return false;
    }
    const trimmed = url.trim();
    return (
      trimmed.startsWith('/') ||
      /^https?:\/\//i.test(trimmed) ||
      /^mailto:/i.test(trimmed) ||
      /^tel:/i.test(trimmed)
    );
  }
}
