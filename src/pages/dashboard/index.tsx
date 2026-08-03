import { PageLayout } from "@/layouts";

const Dashboard = () => {
  return (
    <PageLayout
      title="Dashboard"
      description="Settings and configuration for your closing coach."
    >
      <p className="text-sm text-muted-foreground">
        Configure AI providers, models, and closing coach settings in Dev Space.
      </p>
    </PageLayout>
  );
};

export default Dashboard;
