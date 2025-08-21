import React, { useEffect, useRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';

export default function BpmnEditor() {
  const ref = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<any>(null);

  useEffect(() => {
    modelerRef.current = new BpmnModeler({ container: ref.current! });
    return () => modelerRef.current?.destroy();
  }, []);

  return (
    <div className="bpmn-editor" style={{ height: 400, border: '1px solid #ddd' }}>
      <div ref={ref} style={{ height: '100%' }} />
    </div>
  );
}
