"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useGlobalState } from "@/components/GlobalState";
import { NotificationData, NotificationItem } from "@/components/NotificationItem";
import { Bell } from "lucide-react";

const API_BASE_URL = (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

export default function ActivityPage() {
    const { currentUser } = useGlobalState();
    const userWallet = currentUser?.wallet;

    const [notifications, setNotifications] = useState<NotificationData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    const fetchNotifications = async (page: number = 1) => {
        if (!userWallet) return;

        setIsLoading(true);
        try {
            const response = await fetch(
                `${API_BASE_URL}/notifications?page=${page}&limit=15`,
                {
                    headers: {
                        'x-user-wallet': userWallet,
                    },
                }
            );

            if (response.ok) {
                const data = await response.json();
                const fetchedNotifications = data.notifications || [];
                
                if (page === 1) {
                    if (fetchedNotifications.length > 0) {
                        setNotifications(fetchedNotifications);
                        setHasMore(page < (data.totalPages || 1));
                    } else {
                        setNotifications([]);
                        setHasMore(false);
                    }
                } else {
                    setNotifications((prev) => [...prev, ...fetchedNotifications]);
                    setHasMore(page < (data.totalPages || 1));
                }
                setCurrentPage(page);
            }
        } catch (error) {
            console.error('Failed to fetch notifications:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleMarkAsRead = async (notificationId: string) => {
        if (!userWallet) return;
        try {
            await fetch(`${API_BASE_URL}/notifications/${notificationId}/read`, {
                method: 'PATCH',
                headers: {
                    'x-user-wallet': userWallet,
                },
            });

            setNotifications((prev) =>
                prev.map((notif) =>
                    notif.id === notificationId ? { ...notif, isRead: true } : notif
                )
            );
        } catch (error) {
            console.error('Failed to mark notification as read:', error);
        }
    };

    useEffect(() => {
        if (userWallet) {
            fetchNotifications(1);
        }
    }, [userWallet]);

    const RightSidebar = (
        <div className="bg-secondary/20 rounded-xl p-6 border border-border">
            <h3 className="font-bold text-lg mb-2">Activity Feed</h3>
            <p className="text-sm text-muted-foreground">
                Stay updated on your calls, stakes, and followers in real-time.
            </p>
        </div>
    );

    return (
        <AppLayout rightSidebar={RightSidebar}>
            <div className="p-4">
                <div className="flex items-center justify-between mb-6 px-2">
                    <h1 className="text-2xl font-bold">Activity</h1>
                </div>

                <div className="space-y-1">
                    {isLoading && notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent"></div>
                            <p className="text-sm text-muted-foreground animate-pulse font-medium">Loading your activity...</p>
                        </div>
                    ) : notifications.length > 0 ? (
                        <>
                            <div className="divide-y divide-border/50 bg-card rounded-2xl border border-border overflow-hidden">
                                {notifications.map((notification) => (
                                    <NotificationItem
                                        key={notification.id}
                                        notification={notification}
                                        onMarkAsRead={handleMarkAsRead}
                                    />
                                ))}
                            </div>

                            {hasMore && (
                                <div className="mt-6 flex justify-center">
                                    <button
                                        onClick={() => fetchNotifications(currentPage + 1)}
                                        disabled={isLoading}
                                        className="px-8 py-3 bg-secondary/50 hover:bg-secondary text-sm font-bold rounded-xl transition-all border border-border disabled:opacity-50"
                                    >
                                        {isLoading ? 'Loading...' : 'Load older activity'}
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-24 px-6 text-center bg-secondary/10 rounded-2xl border border-dashed border-border">
                            <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-6 text-muted-foreground">
                                <Bell className="w-8 h-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-bold text-foreground">No activity yet</h3>
                            <p className="text-muted-foreground text-sm mt-2 max-w-xs">
                                When you receive stakes, new followers, or your markets resolve, they'll appear here.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
