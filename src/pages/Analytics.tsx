import React from "react";
import { motion } from "framer-motion";
import { BarChart3, Users, MessageSquare, Clock, TrendingUp } from "lucide-react";

const stats = [
  { label: "Total Conversations", value: "1,284", change: "+12%", icon: <MessageSquare className="h-5 w-5" /> },
  { label: "Active Customers", value: "342", change: "+8%", icon: <Users className="h-5 w-5" /> },
  { label: "Avg Response Time", value: "2m 14s", change: "-18%", icon: <Clock className="h-5 w-5" /> },
  { label: "Resolution Rate", value: "94.2%", change: "+3%", icon: <TrendingUp className="h-5 w-5" /> },
];

const Analytics: React.FC = () => (
  <div className="p-8 max-w-6xl mx-auto">
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-primary" />
        Analytics
      </h1>
      <p className="text-muted-foreground mt-1">Performance overview of your support operations</p>
    </div>

    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="rounded-xl border border-border bg-card p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {stat.icon}
            </div>
            <span className="text-xs font-medium text-success">{stat.change}</span>
          </div>
          <p className="text-2xl font-bold text-card-foreground">{stat.value}</p>
          <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
        </motion.div>
      ))}
    </div>

    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold text-card-foreground mb-4">Conversation Volume</h3>
      <div className="flex items-end gap-2 h-48">
        {[35, 52, 48, 70, 65, 82, 90, 78, 95, 88, 72, 60].map((val, i) => (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${val}%` }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
            className="flex-1 rounded-t-md bg-primary/70 hover:bg-primary transition-colors cursor-pointer"
            title={`Month ${i + 1}: ${val} conversations`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-2 text-xs text-muted-foreground">
        <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
        <span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span>
      </div>
    </div>
  </div>
);

export default Analytics;
