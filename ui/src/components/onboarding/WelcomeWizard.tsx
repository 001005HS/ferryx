import { useEffect, useState } from "react";

import type { ResolvedAgent } from "../../lib/agentsSettings";
import type { OnboardingStepId } from "../../lib/onboarding";
import type { CliLauncherStatus, SystemPermissionsStatus } from "../../lib/types";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
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
    clampStepIndex(initialStepIndex, steps.length)
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRemindLater();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onRemindLater]);

  if (steps.length === 0) {
    return null;
  }

  const currentStepIndex = clampStepIndex(stepIndex, steps.length);
  const currentStep = steps[currentStepIndex];
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === steps.length - 1;
  const progressValue = ((currentStepIndex + 1) / steps.length) * 100;

  const handleNext = () => {
    if (currentStep) {
      onStepCompleted(currentStep);
    }
    setStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
  };

  const handleBack = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleFinish = () => {
    if (currentStep) {
      onStepCompleted(currentStep);
    }
    onFinish();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-label="Welcome to Ferryx"
        className="flex w-full max-w-xl max-h-[90vh] flex-col rounded-xl border border-border bg-background p-6 shadow-2xl overflow-y-auto"
      >
        <div className="space-y-3 pb-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Welcome to Ferryx
            </h1>
            <span
              data-testid="onboarding-step-indicator"
              className="text-xs font-medium text-muted-foreground"
            >
              Step {currentStepIndex + 1} of {steps.length}
            </span>
          </div>
          <Progress value={progressValue} className="h-1.5" />
        </div>

        <div className="flex-1 py-2">{renderStepContent()}</div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              data-testid="onboarding-skip"
              onClick={onSkip}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Skip setup
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="onboarding-remind-later"
              onClick={onRemindLater}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Remind me later
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                variant="outline"
                size="sm"
                data-testid="onboarding-back"
                onClick={handleBack}
                className="text-xs"
              >
                Back
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                data-testid="onboarding-finish"
                onClick={handleFinish}
                className="text-xs"
              >
                Finish
              </Button>
            ) : (
              <Button
                size="sm"
                data-testid="onboarding-next"
                onClick={handleNext}
                className="text-xs"
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
