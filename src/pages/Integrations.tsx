import React from "react";
import { motion } from "framer-motion";
import { MessageSquare, Phone, Mail, Hash, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const integrations = [
  {
    id: "sms",
    name: "SMS",
    description: "Send and receive text messages from customers directly in threads.",
    icon: <MessageSquare className="h-6 w-6" />,
    status: "available" as const,
    provider: "Twilio",
  },
  {
    id: "phone",
    name: "Phone Calls",
    description: "Handle inbound and outbound voice calls with automatic transcription.",
    icon: <Phone className="h-6 w-6" />,
    status: "available" as const,
    provider: "Twilio Voice",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Sync email conversations and send replies without leaving ConvoHub.",
    icon: <Mail className="h-6 w-6" />,
    status: "available" as const,
    provider: "Google Workspace",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Get notifications in Slack channels and collaborate on customer threads.",
    icon: <Hash className="h-6 w-6" />,
    status: "available" as const,
    provider: "Slack API",
  },
];

const Integrations: React.FC = () => (
  <div className="p-8 max-w-4xl mx-auto">
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-foreground">Integrations</h1>
      <p className="text-muted-foreground mt-1">Connect your communication channels</p>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      {integrations.map((intg, i) => (
        <motion.div
          key={intg.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="rounded-xl border border-border bg-card p-6 flex flex-col"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {intg.icon}
            </div>
            <Badge variant="outline" className="text-xs">
              {intg.provider}
            </Badge>
          </div>
          <h3 className="text-lg font-semibold text-card-foreground mb-1">{intg.name}</h3>
          <p className="text-sm text-muted-foreground mb-6 flex-1">{intg.description}</p>
          <Button variant="outline" className="w-full gap-2">
            <ExternalLink className="h-3.5 w-3.5" />
            Configure
          </Button>
        </motion.div>
      ))}
    </div>
  </div>
);

export default Integrations;
