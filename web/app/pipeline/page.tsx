'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface StepConfig {
  name: string;
  enabled?: boolean;
  every?: number;
  batchSize?: number;
  maxTasks?: number;
  agents?: string[];
}

interface ModuleConfig {
  tickInterval?: number;
  minFindings?: number;
  steps: StepConfig[];
}

const MODULE_NAMES = ['research', 'discovery', 'paper', 'library'];

const MODULE_COLORS: Record<string, string> = {
  research: '#338',
  discovery: '#383',
  paper: '#833',
  library: '#883',
};

function buildNodes(modules: Record<string, ModuleConfig>): Node[] {
  const nodes: Node[] = [];
  let y = 0;

  for (const [moduleName, config] of Object.entries(modules)) {
    const color = MODULE_COLORS[moduleName] ?? '#444';

    // Module header node
    nodes.push({
      id: `${moduleName}-header`,
      position: { x: 0, y },
      data: { label: `${moduleName} (tick: ${config.tickInterval ?? '?'}ms)` },
      style: { background: color, color: '#fff', fontWeight: 'bold', borderRadius: '8px', padding: '8px 16px', border: `2px solid ${color}`, width: 250 },
      draggable: true,
    });

    let stepY = y + 60;
    for (const step of config.steps) {
      const enabled = step.enabled !== false;
      nodes.push({
        id: `${moduleName}-${step.name}`,
        position: { x: 40, y: stepY },
        data: {
          label: `${step.name}${step.every ? ` (every ${step.every})` : ''}${step.batchSize ? ` [batch:${step.batchSize}]` : ''}`,
        },
        style: {
          background: enabled ? '#1a1a2e' : '#1a1a1a',
          color: enabled ? '#e0e0e0' : '#555',
          border: `1px solid ${enabled ? '#333' : '#222'}`,
          borderRadius: '4px',
          padding: '6px 12px',
          fontSize: '12px',
          width: 220,
          opacity: enabled ? 1 : 0.5,
        },
        draggable: true,
      });
      stepY += 45;
    }

    y = stepY + 30;
  }

  return nodes;
}

function buildEdges(modules: Record<string, ModuleConfig>): Edge[] {
  const edges: Edge[] = [];

  for (const [moduleName, config] of Object.entries(modules)) {
    // Connect header to first step
    if (config.steps.length > 0) {
      edges.push({
        id: `${moduleName}-header-to-${config.steps[0].name}`,
        source: `${moduleName}-header`,
        target: `${moduleName}-${config.steps[0].name}`,
        style: { stroke: '#444' },
      });
    }

    // Connect steps sequentially
    for (let i = 0; i < config.steps.length - 1; i++) {
      edges.push({
        id: `${moduleName}-${config.steps[i].name}-to-${config.steps[i + 1].name}`,
        source: `${moduleName}-${config.steps[i].name}`,
        target: `${moduleName}-${config.steps[i + 1].name}`,
        style: { stroke: '#333' },
      });
    }
  }

  // Inter-module connections
  edges.push(
    { id: 'lib-to-res', source: 'library-header', target: 'research-header', style: { stroke: '#555', strokeDasharray: '5,5' }, label: 'documents', labelStyle: { fill: '#666', fontSize: 10 } },
    { id: 'res-to-disc', source: 'research-header', target: 'discovery-header', style: { stroke: '#555', strokeDasharray: '5,5' }, label: 'findings', labelStyle: { fill: '#666', fontSize: 10 } },
    { id: 'disc-to-paper', source: 'discovery-header', target: 'paper-header', style: { stroke: '#555', strokeDasharray: '5,5' }, label: 'discoveries', labelStyle: { fill: '#666', fontSize: 10 } },
  );

  return edges;
}

export default function PipelinePage() {
  const [modules, setModules] = useState<Record<string, ModuleConfig>>({});
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedStep, setSelectedStep] = useState<{ module: string; step: StepConfig; index: number } | null>(null);

  useEffect(() => {
    fetch('/api/modules')
      .then(r => r.json())
      .then((configs: Record<string, ModuleConfig>) => {
        // Library doesn't have steps in config — add pipeline stages
        if (!configs.library?.steps?.length) {
          configs.library = {
            ...configs.library,
            steps: [
              { name: 'fetch-sources', enabled: true },
              { name: 'download', enabled: true },
              { name: 'extract', enabled: true },
              { name: 'classify', enabled: true },
              { name: 'embed', enabled: true },
            ],
          };
        }
        setModules(configs);
        setNodes(buildNodes(configs));
        setEdges(buildEdges(configs));
      });
  }, []);

  const toggleStep = async (moduleName: string, stepName: string) => {
    const config = modules[moduleName];
    if (!config) return;
    const step = config.steps.find(s => s.name === stepName);
    if (!step) return;

    const newEnabled = step.enabled === false;
    step.enabled = newEnabled;

    // Update UI immediately
    const updated = { ...modules };
    setModules(updated);
    setNodes(buildNodes(updated));

    // Queue config change
    const stepIndex = config.steps.indexOf(step);
    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_config',
        payload: { module: moduleName, key: `steps.${stepIndex}.enabled`, value: newEnabled },
      }),
    });
  };

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  return (
    <div>
      <h1>Pipeline Flow</h1>
      <p style={{ color: '#888', marginBottom: '16px' }}>
        Visual overview of the research pipeline. Drag to rearrange. Double-click a step to toggle enabled/disabled.
      </p>
      <div style={{ height: '700px', background: '#0a0a0a', border: '1px solid #222', borderRadius: '8px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_event, node) => {
            if (!node.id.endsWith('-header')) {
              const parts = node.id.split('-');
              const moduleName = parts[0];
              const stepName = parts.slice(1).join('-');
              const config = modules[moduleName];
              const stepIndex = config?.steps.findIndex(s => s.name === stepName);
              if (config && stepIndex !== undefined && stepIndex >= 0) {
                setSelectedStep({ module: moduleName, step: { ...config.steps[stepIndex] }, index: stepIndex });
              }
            }
          }}
          onNodeDoubleClick={(_event, node) => {
            if (!node.id.endsWith('-header')) {
              const parts = node.id.split('-');
              const moduleName = parts[0];
              const stepName = parts.slice(1).join('-');
              toggleStep(moduleName, stepName);
            }
          }}
          fitView
          colorMode="dark"
        >
          <Background color="#222" gap={20} />
          <Controls />
        </ReactFlow>
      </div>
      {selectedStep && (
        <StepEditor
          moduleName={selectedStep.module}
          step={selectedStep.step}
          stepIndex={selectedStep.index}
          onSave={async (updated) => {
            const config = modules[selectedStep.module];
            config.steps[selectedStep.index] = updated;
            const newModules = { ...modules };
            setModules(newModules);
            setNodes(buildNodes(newModules));
            setSelectedStep(null);

            await fetch('/api/admin/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'modify_config',
                payload: { module: selectedStep.module, key: `steps.${selectedStep.index}`, value: updated },
              }),
            });
          }}
          onClose={() => setSelectedStep(null)}
        />
      )}
    </div>
  );
}

function StepEditor({ moduleName, step, stepIndex, onSave, onClose }: {
  moduleName: string;
  step: StepConfig;
  stepIndex: number;
  onSave: (updated: StepConfig) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(step);

  return (
    <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginTop: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>{moduleName} / {s.name}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px' }}>×</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <div>
          <label style={{ display: 'block', color: '#888', fontSize: '11px', marginBottom: '4px' }}>Enabled</label>
          <select value={s.enabled !== false ? 'yes' : 'no'} onChange={e => setS({ ...s, enabled: e.target.value === 'yes' })}
            style={{ width: '100%', padding: '6px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0' }}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', color: '#888', fontSize: '11px', marginBottom: '4px' }}>Every (seconds)</label>
          <input type="number" value={s.every ?? ''} placeholder="—"
            onChange={e => setS({ ...s, every: e.target.value ? parseInt(e.target.value) : undefined })}
            style={{ width: '100%', padding: '6px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ display: 'block', color: '#888', fontSize: '11px', marginBottom: '4px' }}>Batch Size</label>
          <input type="number" value={s.batchSize ?? ''} placeholder="—"
            onChange={e => setS({ ...s, batchSize: e.target.value ? parseInt(e.target.value) : undefined })}
            style={{ width: '100%', padding: '6px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ display: 'block', color: '#888', fontSize: '11px', marginBottom: '4px' }}>Max Tasks</label>
          <input type="number" value={s.maxTasks ?? ''} placeholder="—"
            onChange={e => setS({ ...s, maxTasks: e.target.value ? parseInt(e.target.value) : undefined })}
            style={{ width: '100%', padding: '6px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button onClick={() => onSave(s)}
            style={{ padding: '6px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
