import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Props = {
  orderId: number;
  customerName: string;
  kind: "manual" | "recurring";
  testId?: string;
};

export function OrderDeleteButton({ orderId, customerName, kind, testId }: Props) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const manual = kind === "manual";

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const url = manual
        ? "/api/orders/" + orderId + "?confirm=" + orderId
        : "/api/recurring-orders/" + orderId;
      const response = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Server rejected the deletion (HTTP " + response.status + ")");
      }
      return response.json();
    },
    onSuccess: () => {
      setOpen(false);
      // The same order can appear in several places, including kitchen
      // production, stamps, delivery routes and order totals.
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders/previous-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
      toast({
        title: manual ? "Manual order deleted" : "Recurring template removed",
        description: manual
          ? "The order was removed from this week's operational totals."
          : "Any already-stamped orders remain unchanged.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to delete", description: error.message, variant: "destructive" });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={next => {
      if (!deleteMutation.isPending) {
        if (!next) deleteMutation.reset();
        setOpen(next);
      }
    }}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={deleteMutation.isPending}
          aria-label={manual ? "Delete manual order for " + customerName : "Delete recurring template for " + customerName}
          title={manual ? "Delete this manual order" : "Remove this recurring customer template"}
          data-testid={testId}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {manual ? "Delete this manual order?" : "Remove recurring customer?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {manual
              ? "Permanently remove order #" + orderId + " for " + customerName + " from the orders, labels and kitchen totals? This cannot be undone. Orders linked to subscriptions, payments or dispatch are protected."
              : "Remove the recurring customer template for " + customerName + "? Already-created Saturday or Tuesday orders will not be deleted."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteMutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Deletion failed."}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            data-testid={"confirm-delete-" + kind + "-" + orderId}
          >
            {deleteMutation.isPending ? "Deleting…" : manual ? "Delete order" : "Remove template"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
