import { Components } from 'formiojs';

// Use BaseComponent for lifecycle + validation hooks.
const BaseComponent: any = (Components as any).components.base;

/**
 * Minimal slider component for Form.io that renders an HTML5 range input.
 * Works with schema: { type: "slider", min, max, step }
 */
export class SliderComponent extends BaseComponent {
  static schema(...extend: any[]) {
    return BaseComponent.schema(
      {
        type: 'slider',
        input: true,      // important for validation and data flow
        label: 'Slider',
        key: 'slider',
        min: 0,
        max: 7,
        step: 1,
        validate: { min: 0, max: 7 }
      },
      ...extend
    );
  }

  static get builderInfo() {
    return {
      title: 'Slider',
      group: 'basic',
      icon: 'sliders-h',
      weight: 30,
      schema: SliderComponent.schema()
    };
  }

  get emptyValue() {
    return null;
  }

  get defaultValue() {
    const min = this.component.min ?? 0;
    const dv = super.defaultValue;
    return dv == null ? min : dv;
  }

  render(children?: any) {
    const min = this.component.min ?? 0;
    const max = this.component.max ?? 7;
    const step = this.component.step ?? 1;
    const value = this.dataValue ?? min;

    // Plain HTML with refs we'll bind in attach()
    return super.render(`
      <div class="redi-slider">
        <div class="redi-slider-head">
          ${this.component.label ? `<label class="control-label">${this.t(this.component.label)}</label>` : ''}
          <div class="redi-slider-value" ref="value">${value}</div>
        </div>
        <div class="redi-slider-track">
          <input ref="input"
                 type="range"
                 min="${min}"
                 max="${max}"
                 step="${step}"
                 value="${value}"
                 class="form-control"/>
          <div class="redi-slider-scale">
            <span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span>
          </div>
        </div>
        ${children || ''}
      </div>
    `);
  }

  private getInputEl(): HTMLInputElement | undefined {
    const ref = (this.refs as any)?.input;
    if (!ref) return undefined;
    return Array.isArray(ref) ? ref[0] : ref;
  }

  attach(element: any) {
    const attached = super.attach(element);
    this.loadRefs(element, { input: 'single', value: 'single' });

    // Normalize refs.input to an array so Form.io internals (setErrorClasses) can iterate safely.
    const refs: any = this.refs;
    if (refs.input && !Array.isArray(refs.input)) {
      refs.input = [refs.input];
    }

    const input = this.getInputEl();
    const valueEl = (this.refs as any).value as HTMLElement;

    const update = () => {
      const v = input && input.value !== '' ? Number(input.value) : null;
      this.updateValue(v, { modified: true });
      if (valueEl) valueEl.textContent = v == null ? '' : String(v);
    };

    if (input) {
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    }
    return attached;
  }

  // Keep UI in sync if value changes programmatically.
  setValue(value: any, flags?: any) {
    const changed = super.setValue(value, flags);
    const input = this.getInputEl();
    const valueEl = (this.refs as any)?.value as HTMLElement | undefined;

    if (input && this.dataValue != null && input.value !== String(this.dataValue)) {
      input.value = String(this.dataValue);
    }
    if (valueEl) {
      valueEl.textContent = this.dataValue == null ? '' : String(this.dataValue);
    }
    return changed;
  }
}