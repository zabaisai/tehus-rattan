"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES } from "@/lib/password-policy";

// Un solo resumen de la política para todos los asesores (la lista viva
// completa está en el paso del administrador); el error de validación
// identifica a qué asesor le falta.
const PASSWORD_HINT = `Contraseña temporal: ${PASSWORD_RULES.map((r) => r.label.toLowerCase()).join(", ")}.`;

import type { AgentDraft } from "@/lib/onboarding-wizard";

export type { AgentDraft };

interface AgentsStepProps {
  value: AgentDraft[];
  onChange: (agents: AgentDraft[]) => void;
}

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
      <h3 className="text-lg font-semibold text-content-primary">Asesores</h3>
      <p className="mt-1.5 text-sm text-content-secondary">
        Puedes agregar asesores ahora o hacerlo después dentro del CRM. Todos
        se crean con rol Asesor.
      </p>
      <p className="mt-1 text-xs text-content-secondary">{PASSWORD_HINT}</p>

      {value.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface-subtle px-4 py-6 text-center">
          <p className="text-sm text-content-secondary">
            Aún no has agregado asesores. Puedes continuar sin ninguno.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {value.map((agent, index) => (
          <Card key={index} padding="sm" flat>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-content-secondary">
                Asesor {index + 1} · Rol: Asesor
              </p>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => removeAgent(index)}
                aria-label={`Quitar asesor ${index + 1}`}
                className="p-1 hover:bg-status-error-surface hover:text-status-error"
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>

            {/* Los tres campos llevaban solo `placeholder`, que desaparece al
                escribir y no es un nombre accesible: con varios asesores en
                pantalla no había forma de saber a cuál pertenecía cada uno. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={`Nombre del asesor ${index + 1}`} labelOculta>
                <Input
                  type="text"
                  placeholder="Nombre"
                  value={agent.name}
                  onChange={(e) => updateAgent(index, { name: e.target.value })}
                />
              </Field>

              <Field label={`Email del asesor ${index + 1}`} labelOculta>
                <Input
                  type="email"
                  placeholder="Email"
                  value={agent.email}
                  onChange={(e) => updateAgent(index, { email: e.target.value })}
                />
              </Field>

              <Field
                label={`Contraseña temporal del asesor ${index + 1}`}
                labelOculta
              >
                <Input
                  type="password"
                  placeholder="Contraseña temporal"
                  minLength={PASSWORD_MIN_LENGTH}
                  autoComplete="new-password"
                  value={agent.password}
                  onChange={(e) =>
                    updateAgent(index, { password: e.target.value })
                  }
                />
              </Field>
            </div>
          </Card>
        ))}
      </div>

      <Button
        variant="secondary"
        size="sm"
        onClick={addAgent}
        className="mt-4 border-dashed"
      >
        <Plus size={14} aria-hidden="true" /> Agregar asesor
      </Button>
    </div>
  );
}
