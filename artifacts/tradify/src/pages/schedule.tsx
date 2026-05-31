import { useListAppointments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export default function Schedule() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  
  // The calendar view groups jobs by their scheduled date on the client.
  const { data: appointments, isLoading } = useListAppointments();

  const selectedDateAppointments = appointments?.filter(app => {
    if (!date || !app.startTime) return false;
    const appDate = new Date(app.startTime);
    return appDate.toDateString() === date.toDateString();
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Schedule</h1>
        <p className="text-muted-foreground mt-2">Manage appointments and scheduling.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <Card className="col-span-1 border-none shadow-none bg-transparent">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-md border bg-card"
          />
        </Card>

        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>
              {date ? date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Select a date'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isLoading ? (
                [1,2].map(i => <Skeleton key={i} className="h-20 w-full" />)
              ) : selectedDateAppointments?.length ? (
                selectedDateAppointments.map(app => (
                  <div key={app.id} className="flex gap-4 p-4 border rounded-lg">
                    <div className="min-w-24 border-r pr-4 text-sm font-medium">
                      {new Date(app.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                    <div>
                      <h4 className="font-semibold">{app.title}</h4>
                      <p className="text-sm text-muted-foreground">{app.customerName}</p>
                      <div className="mt-2">
                         <Badge variant="outline">{app.status}</Badge>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No appointments for this date.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
