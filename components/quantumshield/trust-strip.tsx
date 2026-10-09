"use client";
import { Shield } from "lucide-react";
import { TechnicalDetails } from "./design-system";
import { useI18n } from "./i18n";

export function TrustStrip() {
  const { t } = useI18n();
  return (
    <footer className="mt-8 border-t px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[1440px]">
        <p className="flex items-start gap-2 text-sm">
          <Shield className="mt-0.5 size-4 shrink-0 text-primary" />
          {t("trust.line")}
        </p>
        <div className="mt-3 max-w-3xl text-sm text-muted-foreground">
          <TechnicalDetails title={t("trust.techTitle")}>
            <p>{t("trust.note")}</p>
            <p>{t("trust.services")}</p>
          </TechnicalDetails>
        </div>
      </div>
    </footer>
  );
}
