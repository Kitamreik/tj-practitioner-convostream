import React from "react";
import { motion } from "framer-motion";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const mockPeople = [
  { id: "1", name: "Sarah Mitchell", email: "sarah@example.com", phone: "+1 555-0101", conversations: 12, lastActive: "2 min ago", tags: ["VIP", "Premium"] },
  { id: "2", name: "James Rodriguez", email: "james@example.com", phone: "+1 555-0102", conversations: 8, lastActive: "15 min ago", tags: ["New"] },
  { id: "3", name: "Emily Chen", email: "emily@example.com", phone: "+1 555-0103", conversations: 23, lastActive: "1 hr ago", tags: ["Enterprise"] },
  { id: "4", name: "Michael Brown", email: "michael@example.com", phone: "+1 555-0104", conversations: 5, lastActive: "3 hrs ago", tags: [] },
  { id: "5", name: "Lisa Anderson", email: "lisa@example.com", phone: "+1 555-0105", conversations: 17, lastActive: "1 day ago", tags: ["VIP"] },
];

const People: React.FC = () => {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">People</h1>
          <p className="text-muted-foreground mt-1">Unified view of every customer</p>
        </div>
        <Button className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search people by name, email, or phone..." className="pl-9 max-w-md" />
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Person</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Threads</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Last Active</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Tags</th>
            </tr>
          </thead>
          <tbody>
            {mockPeople.map((person, i) => (
              <motion.tr
                key={person.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {person.name.charAt(0)}
                    </div>
                    <span className="font-medium text-foreground">{person.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-foreground">{person.email}</p>
                  <p className="text-xs text-muted-foreground">{person.phone}</p>
                </td>
                <td className="px-6 py-4 text-sm text-foreground">{person.conversations}</td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{person.lastActive}</td>
                <td className="px-6 py-4">
                  <div className="flex gap-1">
                    {person.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default People;
