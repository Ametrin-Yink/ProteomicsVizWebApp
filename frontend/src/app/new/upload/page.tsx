/**
 * Step 1: File Upload & Experiment Setup
 * Upload PSM CSV files, review parsed metadata, configure experiment structure
 */

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2, Upload, Database, CheckCircle, Info } from 'lucide-react';
import FileUploadZone from '@/components/analysis/FileUploadZone';
import ExperimentTable from '@/components/analysis/ExperimentTable';
import ValidationPanel from '@/components/analysis/ValidationPanel';
import { useAnalysisStore, getValidation, getConditions } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, mapBackendFiles } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, setConfig, setAvailableOrganisms, availableOrganisms } = state;
  const conditions = getConditions(state);
  const validation = getValidation(state);
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = useState(false);
  const [organismsLoaded, setOrganismsLoaded] = useState(false);

  // Load organisms on mount
  useEffect(() => {
    if (!sessionId || organismsLoaded) return;

    const loadOrganisms = async () => {
      try {
        const resp = await fetch('/api/organisms');
        if (resp.ok) {
          const data = await resp.json();
          const organisms = Array.isArray(data) ? data : data.organisms || [];
          setAvailableOrganisms(
            organisms.map((o: { id?: string; name?: string; display_name?: string; available?: boolean }) => ({
              id: o.id || o.name || 'unknown',
              name: o.name || o.id || 'unknown',
              display_name: o.display_name || o.name || 'Unknown',
              available: o.available !== false,
            }))
          );
        }
      } catch (error) {
        console.error('Failed to load organisms:', error);
      } finally {
        setOrganismsLoaded(true);
      }
    };

    loadOrganisms();
  }, [sessionId, organismsLoaded, setAvailableOrganisms]);

  // Restore session state on page load
  useEffect(() => {
    if (!sessionId) return;

    const restoreSession = async () => {
      try {
        const sessionResp = await fetch(`/api/sessions/${sessionId}`);
        if (sessionResp.ok) {
          const raw = await sessionResp.json();
          const files = mapBackendFiles(raw.files);
          if (files.length > 0) {
            const { addUploadedFile } = useAnalysisStore.getState();
            for (const file of files) {
              addUploadedFile(file);
            }
          }

          // Restore config from raw backend response
          const cfg = raw.config as Record<string, unknown> | null;
          if (cfg && typeof cfg === 'object') {
            const updates: Partial<typeof config> = {};
            const conditions = cfg.conditions as string[] | undefined;
            if (conditions && conditions.length >= 2) {
              updates.treatment = conditions[1];
              updates.control = conditions[0];
            }
            if (typeof cfg.treatment === 'string') updates.treatment = cfg.treatment;
            if (typeof cfg.control === 'string') updates.control = cfg.control;
            if (typeof cfg.organism === 'string') updates.organism = cfg.organism;
            if (typeof cfg.remove_razor === 'boolean') updates.remove_razor = cfg.remove_razor;
            if (typeof cfg.strict_filtering === 'boolean') updates.strict_filtering = cfg.strict_filtering;
            if (cfg.pipeline === 'msqrob2' || cfg.pipeline === 'msstats') updates.pipeline = cfg.pipeline;
            if (Object.keys(updates).length > 0) {
              setConfig(updates);
            }
          }
        }
      } catch {
        // Session restoration failed, user can start fresh
      }
    };

    restoreSession();
  }, [sessionId, setConfig]);

  // Validate session ID
  useEffect(() => {
    if (!sessionId) {
      addToast('error', 'No session found. Please start a new analysis.');
      router.push('/');
    }
  }, [sessionId, router, addToast]);

  const canContinue =
    validation.selectedFiles.length > 0 &&
    config.treatment !== '' &&
    config.control !== '' &&
    config.organism !== '' &&
    validation.isValid;

  const handleContinue = async () => {
    if (!canContinue || !sessionId) return;

    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, config);
      router.push(`/new/pipeline?session=${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save configuration';
      addToast('error', `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text">Upload & Experiment Setup</h1>
        <p className="text-text-muted mt-1">
          Upload your PSM CSV files and configure the experimental conditions
        </p>
      </div>

      {/* File Upload */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Upload className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Data Input</h2>
            <p className="text-sm text-text-muted">
              Upload PSM CSV files (format: PSM_ExperimentName_Condition_Replicate.csv)
            </p>
          </div>
        </div>
        <div className="p-5">
          <FileUploadZone sessionId={sessionId} />
        </div>
      </section>

      {/* Experiment Table */}
      {state.uploadedFiles.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-text">Experiment Structure</h2>
              <p className="text-sm text-text-muted">
                Review parsed files and select which to include
              </p>
            </div>
          </div>
          <div className="p-5">
            <ExperimentTable />
          </div>
        </section>
      )}

      {/* Experiment Configuration */}
      {conditions.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Info className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-text">Experiment Configuration</h2>
              <p className="text-sm text-text-muted">
                Set treatment/control conditions, organism, and filtering options
              </p>
            </div>
          </div>
          <div className="p-5 space-y-5">
            {/* Treatment / Control selectors */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Treatment Condition
                </label>
                <select
                  data-testid="treatment-select"
                  value={config.treatment}
                  onChange={(e) => setConfig({ treatment: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                    focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
                    transition-colors"
                >
                  <option value="">Select treatment...</option>
                  {conditions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Control Condition
                </label>
                <select
                  data-testid="control-select"
                  value={config.control}
                  onChange={(e) => setConfig({ control: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                    focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
                    transition-colors"
                >
                  <option value="">Select control...</option>
                  {conditions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Organism selector */}
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Organism
              </label>
              <select
                data-testid="organism-select"
                value={config.organism}
                onChange={(e) => setConfig({ organism: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
                  transition-colors"
              >
                <option value="">Select organism...</option>
                {availableOrganisms
                  .filter((o) => o.available)
                  .map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.display_name || org.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Toggles */}
            <div className="space-y-3 pt-2">
              <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
                <div>
                  <span className="text-sm font-medium text-text">Remove Razor Peptides</span>
                  <p className="text-xs text-text-muted mt-0.5">
                    Exclude peptides matching multiple protein groups
                  </p>
                </div>
                <input
                  data-testid="remove-razor-checkbox"
                  type="checkbox"
                  checked={config.remove_razor}
                  onChange={(e) => setConfig({ remove_razor: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
                  after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
                  after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
                  peer-checked:after:translate-x-5"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
                <div>
                  <span className="text-sm font-medium text-text">Strict Filtering</span>
                  <p className="text-xs text-text-muted mt-0.5">
                    20% missing value threshold, remove single-peptide proteins
                  </p>
                </div>
                <input
                  data-testid="strict-filtering-checkbox"
                  type="checkbox"
                  checked={config.strict_filtering}
                  onChange={(e) => setConfig({ strict_filtering: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
                  after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
                  after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
                  peer-checked:after:translate-x-5"
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {/* Validation */}
      {state.uploadedFiles.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-text">Validation</h2>
              <p className="text-sm text-text-muted">Check experiment setup requirements</p>
            </div>
          </div>
          <div className="p-5">
            <ValidationPanel />
          </div>
        </section>
      )}

      {/* Continue button */}
      <div className="flex justify-end pt-4">
        <button
          data-testid="upload-continue-btn"
          onClick={handleContinue}
          disabled={!canContinue || isSaving}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            canContinue && !isSaving
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-border text-text-muted cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue to Pipeline Selection
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      }
    >
      <UploadContent />
    </Suspense>
  );
}
