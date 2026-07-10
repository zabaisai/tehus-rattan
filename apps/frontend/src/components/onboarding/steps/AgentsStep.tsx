"use client";

import { Plus, Trash2 } from "lucide-react";

export interface AgentDraft {
  name: string;
  email: string;
  password: string;
}

interface AgentsStepProps {
  value: AgentDraft[];
  onChange: (agents: AgentDraft[]) => void;
}

const inputClass =
  "w-full rounded-md border border-[#0B0F10]/15 px-3 py-2 text-sm outline-none focus:border-[#A57014] focus:ring-1 focus:ring-[#A57014]";

export function AgentsStep({ value, onChange }: AgentsStepProps) {
  function addAgent() {
    onChange([...value, { name: "", email: "", password: "" }]);
  }

  function updateAgent(index: number, patch: Partial<AgentDraft>) {
    onChange(value.map((agent, i) => (i === index ? { ...agent, ...patch } : agent)));
  }

  function removeAgent(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-[#0B0F10]">Asesores</h3>
      <p className="mt-1.5 text-sm text-[#0B0F10]/70">
        Puedes agregar asesores ahora o hacerlo después dentro del CRM. Todos
        se crean con rol Asesor.
      </p>

      {value.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-[#0B0F10]/15 bg-[#F4EFE6] px-4 py-6 text-center">
          <p className="text-sm text-[#0B0F10]/60">
            Aún no has agregado asesores. Puedes continuar sin ninguno.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {value.map((agent, index) => (
          <div key={index} className="rounded-lg border border-[#0B0F10]/10 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-[#0B0F10]/50">
                Asesor {index + 1} · Rol: Asesor
              </p>
              <button
                type="button"
                onClick={() => removeAgent(index)}
                className="rounded p-1 text-[#0B0F10]/40 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="text"
                placeholder="Nombre"
                value={agent.name}
                onChange={(e) => updateAgent(index, { name: e.target.value })}
                className={inputClass}
              />
              <input
                type="email"
                placeholder="Email"
                value={agent.email}
                onChange={(e) => updateAgent(index, { email: e.target.value })}
                className={inputClass}
              />
              <input
                type="password"
                placeholder="Contraseña temporal"
                value={agent.password}
                onChange={(e) => updateAgent(index, { password: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addAgent}
        className="mt-4 flex items-center gap-1.5 rounded-md border border-dashed border-[#0B0F10]/20 px-3 py-2 text-xs font-medium text-[#0B0F10]/70 hover:bg-[#F4EFE6]"
      >
        <Plus size={14} /> Agregar asesor
      </button>
    </div>
  );
}
