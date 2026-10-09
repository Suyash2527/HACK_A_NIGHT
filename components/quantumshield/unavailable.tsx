"use client";
import { CloudOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useI18n } from "./i18n";

export function PublicVerifyUnavailable() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-4">
      <Alert className="border-pending/30">
        <CloudOff className="text-pending" />
        <AlertTitle>{t("unavail.title", { feature: t("pub.title") })}</AlertTitle>
        <AlertDescription>{t("pub.help")}</AlertDescription>
      </Alert>
    </div>
  );
}
