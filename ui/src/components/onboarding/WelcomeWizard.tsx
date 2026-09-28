import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import type { ResolvedAgent } from "../../lib/agentsSettings";
import { cn } from "../../lib/cn";
import type { OnboardingStepId } from "../../lib/onboarding";
import type { CliLauncherStatus, SystemPermissionsStatus } from "../../lib/types";
import { Button } from "../ui/button";
import { IconButton } from "../ui/IconButton";
import { AgentsCliStep } from "./AgentsCliStep";
import { FirstProjectStep } from "./FirstProjectStep";
import { IntroStep } from "./IntroStep";
import { PermissionsStep } from "./PermissionsStep";

export type WelcomeWizardProps = {
  steps: readonly OnboardingStepId[];
  permissionsStatus: SystemPermissionsStatus | null;
  agents: ReadonlyArray<ResolvedAgent>;
  isMac: boolean;
  onAddProject: () => void;
  onConnectMachine: () => void;
  onOpenAgentSettings: () => void;
  onStepCompleted: (step: OnboardingStepId) => void;
  onFinish: () => void;
  onSkip: () => void;
  onRemindLater: () => void;
  fetchPermissions?: () => Promise<SystemPermissionsStatus>;
  loadCliStatus?: () => Promise<CliLauncherStatus>;
  installCli?: () => Promise<CliLauncherStatus>;
  initialStepIndex?: number;
};

const STEP_TITLES: Record<OnboardingStepId, string> = {
  intro: "Welcome",
  permissions: "Permissions",
  agents: "Agents & CLI",
  project: "First project",
};

const STEP_HEADINGS: Record<OnboardingStepId, string> = {
  intro: "Set up Ferryx",
  permissions: "Grant system access",
  agents: "Choose your default agent",
  project: "Open your first project",
};

function clampStepIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index) || index <= 0) return 0;
  if (index >= total) return total - 1;
  return Math.floor(index);
}

export function WelcomeWizard(props: WelcomeWizardProps): JSX.Element | null {
  const {
    steps,
    permissionsStatus,
    agents,
    isMac,
    onAddProject,
    onConnectMachine,
    onOpenAgentSettings,
    onStepCompleted,
    onFinish,
    onSkip,
    onRemindLater,
    fetchPermissions,
    loadCliStatus,
    installCli,
    initialStepIndex = 0,
  } = props;

  const [stepIndex, setStepIndex] = useState(() =>
    clampStepIndex(initialStepIndex, steps.length),
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const currentStepIndex = clampStepIndex(stepIndex, steps.length);
  const currentStep = steps[currentStepIndex];
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === steps.length - 1;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [currentStepIndex]);

  if (steps.length === 0 || !currentStep) {
    return null;
  }

  const handleNext = () => {
    onStepCompleted(currentStep);
    setStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
  };

  const handleBack = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleFinish = () => {
    onStepCompleted(currentStep);
    onFinish();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onRemindLater();
      return;
    }

    if (event.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  };

  const getLedeText = (step: OnboardingStepId): string => {
    switch (step) {
      case "intro":
        return "A few things to know, then we'll get your first project open.";
      case "permissions":
        return isMac
          ? "These let agents and git work without macOS prompts. Change them anytime in Settings > Permissions."
          : "Your operating system controls whether Ferryx can show notifications.";
      case "agents":
        return "New agent tabs start with this one. You can switch per tab, or change it later in Settings > Agents.";
      case "project":
        return "Start with a folder on this computer, or pair another machine.";
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "intro":
        return <IntroStep isMac={isMac} />;
      case "permissions":
        return (
          <PermissionsStep
            initialStatus={permissionsStatus}
            fetchStatus={fetchPermissions}
          />
        );
      case "agents":
        return (
          <AgentsCliStep
            agents={agents}
            onOpenAgentSettings={onOpenAgentSettings}
            loadCliStatus={loadCliStatus}
            installCli={installCli}
          />
        );
      case "project":
        return (
          <FirstProjectStep
            onAddProject={() => {
              onStepCompleted("project");
              onAddProject();
            }}
            onConnectMachine={() => {
              onStepCompleted("project");
              onConnectMachine();
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Ferryx"
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-3xl max-h-[min(40rem,90vh)] overflow-hidden rounded-lg border border-border bg-card shadow-lg sm:grid sm:grid-cols-[13rem_1fr]"
      >
        <div className="hidden sm:flex min-h-0 flex-col border-r border-border bg-background/40 p-4">
          <div className="flex items-center gap-1.5 mb-4">
            <span className="text-[13px] font-semibold text-foreground">
              Ferryx
            </span>
            <span className="text-[11px] text-muted-foreground">Setup</span>
          </div>

          <ol aria-label="Setup steps" className="space-y-1">
            {steps.map((stepId, index) => {
              const isCompleted = index < currentStepIndex;
              const isCurrent = index === currentStepIndex;
              return (
                <li
                  key={stepId}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "h-8 rounded-md px-2 flex items-center gap-2 text-[12px]",
                    isCurrent
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <span className="size-4 flex items-center justify-center shrink-0">
                    {isCompleted ? (
                      <Check
                        className="size-3.5 text-status-success"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className={cn(
                          "text-[11px]",
                          isCurrent
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {index + 1}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{STEP_TITLES[stepId] ?? stepId}</span>
                </li>
              );
            })}
          </ol>

          <p className="mt-auto pt-4 text-[11px] text-muted-foreground">
            You can reopen this from Settings &gt; Permissions.
          </p>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-start justify-between gap-4 px-4 pt-5 sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <span className="sm:hidden text-[12px] font-medium text-muted-foreground">
                  {STEP_TITLES[currentStep]}
                </span>
                <span
                  data-testid="onboarding-step-indicator"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Step {currentStepIndex + 1} of {steps.length}
                </span>
              </div>

              <h2
                id="welcome-step-heading"
                ref={headingRef}
                tabIndex={-1}
                className="mt-1 text-[17px] font-semibold tracking-tight text-foreground outline-none"
              >
                {STEP_HEADINGS[currentStep]}
              </h2>
              <p className="mt-1 max-w-[52ch] text-[13px] leading-relaxed text-muted-foreground">
                {getLedeText(currentStep)}
              </p>
            </div>

            <IconButton
              label="Remind me later"
              data-testid="onboarding-remind-later"
              onClick={onRemindLater}
              size="sm"
            >
              <X className="size-4" />
            </IconButton>
          </div>

          <div
            key={currentStep}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 animate-enter motion-reduce:animate-none sm:px-6"
          >
            {renderStepContent()}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
            <Button
              variant="ghost"
              size="sm"
              data-testid="onboarding-skip"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip setup
            </Button>

            <div className="flex items-center gap-2">
              {!isFirst ? (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="onboarding-back"
                  onClick={handleBack}
                >
                  Back
                </Button>
              ) : null}

              {isLast ? (
                <Button
                  size="sm"
                  data-testid="onboarding-finish"
                  onClick={handleFinish}
                  className="min-w-24"
                >
                  Done
                </Button>
              ) : (
                <Button
                  size="sm"
                  data-testid="onboarding-next"
                  onClick={handleNext}
                  className="min-w-24"
                >
                  Continue
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
