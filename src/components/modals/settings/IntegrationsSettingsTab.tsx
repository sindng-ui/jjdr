import React from "react";
import { GeminiBridgeSettingsSection } from "../GeminiBridgeSettingsSection";
import { UpdateSettingsSection } from "../UpdateSettingsSection";

export const IntegrationsSettingsTab = React.memo(
  function IntegrationsSettingsTab() {
    return (
      <div className="space-y-5">
        <GeminiBridgeSettingsSection />
        <UpdateSettingsSection />
      </div>
    );
  }
);
