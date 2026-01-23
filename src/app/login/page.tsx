'use client';

import { useActionState } from 'react';
import { loginAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

const initialState = {
    error: '',
};

export default function Login() {
    const [state, formAction, isPending] = useActionState(loginAction, initialState);

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md border-border bg-card shadow-lg">
                <CardHeader className="space-y-1 text-center">
                    <CardTitle className="text-3xl font-bold tracking-tight text-primary">MOVIE CLUB</CardTitle>
                    <CardDescription>
                        Enter your credentials to access the club
                    </CardDescription>
                </CardHeader>
                <form action={formAction}>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">Username</Label>
                            <Input
                                id="username"
                                name="username"
                                placeholder="torresgol10"
                                required
                                className="bg-background"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="pin">PIN</Label>
                            <Input
                                id="pin"
                                name="pin"
                                type="password"
                                placeholder="••••"
                                maxLength={4}
                                required
                                className="bg-background"
                            />
                        </div>
                        {state?.error && (
                            <p className="text-sm font-medium text-destructive text-center">
                                {state.error}
                            </p>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button className="w-full" type="submit" disabled={isPending}>
                            {isPending ? 'Authenticating...' : 'Enter the Club'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
}
