'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';

export default function PushNotificationManager() {
    const [isSubscribed, setIsSubscribed] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const isSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

    useEffect(() => {
        if (!isSupported) {
            // Use a microtask to avoid synchronous setState in effect body
            queueMicrotask(() => setIsLoading(false));
            return;
        }

        let cancelled = false;
        async function checkSubscription() {
            try {
                // Use getRegistration instead of .ready — .ready hangs
                // forever if no SW has been registered yet, keeping the
                // button disabled.
                const registration = await navigator.serviceWorker.getRegistration('/');
                if (registration) {
                    const subscription = await registration.pushManager.getSubscription();
                    if (!cancelled) setIsSubscribed(!!subscription);
                }
            } catch {
                // ignore
            }
            if (!cancelled) setIsLoading(false);
        }

        checkSubscription();
        return () => { cancelled = true; };
    }, [isSupported]);

    async function subscribe() {
        setIsLoading(true);
        try {
            // Register service worker if not yet
            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;

            // Get VAPID public key from server
            const res = await fetch('/api/push/subscribe');
            const { publicKey } = await res.json();

            if (!publicKey) {
                toast.error('Push notifications not configured on server');
                setIsLoading(false);
                return;
            }

            // Request permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                toast.error('Notification permission denied');
                setIsLoading(false);
                return;
            }

            // Subscribe
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });

            // Send subscription to server
            await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: subscription.toJSON() }),
            });

            setIsSubscribed(true);
            toast.success('Notificaciones activadas');
        } catch (error) {
            console.error('Push subscription error:', error);
            toast.error('Error al activar notificaciones');
        }
        setIsLoading(false);
    }

    async function unsubscribe() {
        setIsLoading(true);
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();

            if (subscription) {
                const endpoint = subscription.endpoint;
                await subscription.unsubscribe();

                // Remove from server
                await fetch('/api/push/subscribe', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint }),
                });
            }

            setIsSubscribed(false);
            toast.success('Notificaciones desactivadas');
        } catch (error) {
            console.error('Push unsubscribe error:', error);
            toast.error('Error al desactivar notificaciones');
        }
        setIsLoading(false);
    }

    if (!isSupported) return null;

    return (
        <Button
            variant="ghost"
            size="icon"
            title={isSubscribed ? 'Desactivar notificaciones' : 'Activar notificaciones'}
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={isLoading}
        >
            {isSubscribed ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </Button>
    );
}

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
