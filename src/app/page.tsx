'use client';

import { useEffect, useState } from 'react';
import MovieSearch from '@/components/MovieSearch';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Plus, LogOut } from "lucide-react";
import { useActionState } from 'react';
import { createUserAction, logoutAction } from './actions';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rating, setRating] = useState([5]);
  const [activeMovie, setActiveMovie] = useState<any>(null);
  const [hasVetted, setHasVetted] = useState(false);
  const [vettingProgress, setVettingProgress] = useState<{ responded: number; total: number } | null>(null);
  const [createState, createAction, isCreating] = useActionState(createUserAction, null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (createState?.success) {
      setOpen(false);
      alert('User created successfully!');
    }
  }, [createState]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Poll every 5s for updates
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const res = await fetch('/api/movies');
      if (res.status === 401) window.location.href = '/login';
      const json = await res.json();
      setData(json);
      setLoading(false);

      // If Vetting, fetch active movie and vetting status
      if (json.state.phase === 'VETTING' || json.state.phase === 'WATCHING') {
        const mRes = await fetch('/api/vetting');
        const mJson = await mRes.json();
        setActiveMovie(mJson.movie);
        setHasVetted(mJson.hasVetted || false);
        setVettingProgress(mJson.vettingProgress || null);
      } else {
        setHasVetted(false);
        setVettingProgress(null);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function submitVetting(seen: boolean) {
    if (seen && !confirm('Are you sure you have seen this? It will reject the movie.')) return;

    await fetch('/api/vetting', {
      method: 'POST',
      body: JSON.stringify({ seen }),
    });
    loadData();
  }

  function handleMovieSelect(movie: any) {
    console.log('Movie selected:', movie); // Debug log
    setTitle(movie.title);
    if (movie.poster_path) {
      setCover(`https://image.tmdb.org/t/p/original${movie.poster_path}`);
    }
  }

  async function submitMovie(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch('/api/movies', {
      method: 'POST',
      body: JSON.stringify({ title, coverUrl: cover }),
    });
    setTitle('');
    setCover('');
    setSubmitting(false);
    loadData();
  }

  async function submitVote() {
    await fetch('/api/votes', {
      method: 'POST',
      body: JSON.stringify({ score: rating[0] })
    });
    loadData();
    alert('Vote Cast!');
  }

  if (loading || !data) return <div className="flex min-h-screen items-center justify-center">Loading...</div>;

  const { state, mySubmission, stats } = data;

  return (
    <div className="container max-w-4xl mx-auto p-4 space-y-8 min-h-screen pb-20">
      <header className="flex justify-between items-center py-6">
        <div className="flex items-center">
          <img src="/sala404.svg" alt="Sala 404" className="h-12 w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" /> Add Member
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Member</DialogTitle>
                <DialogDescription>
                  Create a new user account for the movie club.
                </DialogDescription>
              </DialogHeader>
              <form action={createAction} className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="username" className="text-right text-sm font-medium">
                    Username
                  </label>
                  <Input id="username" name="username" className="col-span-3" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="pin" className="text-right text-sm font-medium">
                    PIN
                  </label>
                  <Input id="pin" name="pin" maxLength={4} className="col-span-3" required />
                </div>
                {createState?.error && (
                  <p className="text-sm font-medium text-destructive text-center">
                    {createState.error}
                  </p>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating ? 'Creating...' : 'Create User'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <form action={logoutAction}>
            <Button variant="ghost" size="icon" title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
          <Badge variant="outline">Member Area</Badge>
        </div>
      </header>

      {state.phase === 'SUBMISSION' && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">Weekly Selection</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              It's time to choose. Pick a movie that will define this week. Make it count.
            </p>
          </div>

          <div className="grid gap-8">
            {data.rejectedSubmission && (
              <Card className="w-full border-destructive/50 bg-destructive/10 relative overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                  <span className="text-9xl font-black text-destructive rotate-[-15deg]">REJECTED</span>
                </div>
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center justify-between">
                    <span>Proposal Rejected</span>
                    <Badge variant="destructive">Vetoed</Badge>
                  </CardTitle>
                  <CardDescription>Your previous choice was seen by the club. Choose another!</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-4">
                  {data.rejectedSubmission.coverUrl && (
                    <img src={data.rejectedSubmission.coverUrl} className="w-16 h-24 object-cover rounded shadow-sm opacity-50 grayscale" />
                  )}
                  <div>
                    <p className="font-bold text-lg line-through decoration-destructive">{data.rejectedSubmission.title}</p>
                    <p className="text-sm text-muted-foreground">Marked as seen during vetting.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!mySubmission ? (
              <Card className="w-full">
                <CardHeader>
                  <CardTitle>Your Proposal</CardTitle>
                  <CardDescription>Search for a movie to propose for this week.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <MovieSearch onSelect={handleMovieSelect} />

                  <Separator />

                  <form onSubmit={submitMovie} className="space-y-4">
                    <Input
                      placeholder="Movie Title..."
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      required
                    />
                    <Input
                      placeholder="Cover Image URL (Optional)..."
                      value={cover}
                      onChange={e => setCover(e.target.value)}
                    />
                    <Button className="w-full" disabled={submitting}>
                      {submitting ? 'Submitting...' : 'Lock In Choice'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <Card className="w-full border-primary/50 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-center">You have chosen wisely.</CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                  <p className="text-3xl font-bold text-primary">{mySubmission.title}</p>
                  <p className="text-muted-foreground">Waiting for other members...</p>
                </CardContent>
              </Card>
            )}

            {data.queue && data.queue.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.queue.map((m: any) => (
                  <Card key={m.id} className={`overflow-hidden border-2 ${m.title === 'Mystery Movie' ? 'border-dashed border-muted-foreground/30 bg-muted/20' : 'border-primary/50 bg-primary/5'}`}>
                    <div className="aspect-[2/3] flex items-center justify-center bg-muted/10 relative">
                      {m.coverUrl ? (
                        <img src={m.coverUrl} className="object-cover w-full h-full" />
                      ) : (
                        <span className="text-4xl text-muted-foreground/20 font-bold">?</span>
                      )}
                    </div>
                    <CardContent className="p-3 text-center">
                      <p className="font-medium text-sm truncate">{m.title}</p>
                      <p className="text-xs text-muted-foreground">{m.title === 'Mystery Movie' ? 'Locked' : 'Your Pick'}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex justify-between text-sm font-medium">
                  <span>Mission Status</span>
                  <span>{stats.submitted} / {stats.totalUsers} Ready</span>
                </div>
                <Progress value={(stats.submitted / stats.totalUsers) * 100} className="h-2" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {state.phase === 'VETTING' && activeMovie && (
        <div className="space-y-8 animate-in fade-in duration-500 text-center">
          <div className="space-y-2">
            <p className="text-muted-foreground uppercase tracking-widest text-sm">Week {state.week} SelectionCandidate</p>
            <h1 className="text-4xl font-extrabold lg:text-6xl">{activeMovie.title}</h1>
          </div>

          {activeMovie.coverUrl && (
            <div className="relative mx-auto w-fit">
              <img
                src={activeMovie.coverUrl}
                className="rounded-xl shadow-2xl max-w-[300px] hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10"></div>
            </div>
          )}

          <Card className="max-w-md mx-auto">
            <CardHeader>
              <CardTitle>{hasVetted ? 'Waiting for Others' : 'Vetting Process'}</CardTitle>
              <CardDescription>
                {hasVetted
                  ? 'You have confirmed you haven\'t seen this movie. Waiting for other members...'
                  : 'Have you seen this movie before?'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasVetted ? (
                <div className="space-y-4">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Vetting Progress</span>
                    <span>{vettingProgress?.responded || 0} / {vettingProgress?.total || 0}</span>
                  </div>
                  <Progress value={vettingProgress ? (vettingProgress.responded / vettingProgress.total) * 100 : 0} className="h-2" />
                  <p className="text-center text-sm text-muted-foreground animate-pulse">
                    ✓ Your response has been recorded
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Button variant="secondary" onClick={() => submitVetting(false)} className="h-16 text-lg">
                    No, Never
                  </Button>
                  <Button variant="destructive" onClick={() => submitVetting(true)} className="h-16 text-lg">
                    Yes, I have
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {state.phase === 'WATCHING' && activeMovie && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <Card className="overflow-hidden">
            <div className="grid md:grid-cols-2 gap-6 p-6">
              <div className="flex flex-col justify-center items-center space-y-6">
                {activeMovie.coverUrl && (
                  <img
                    src={activeMovie.coverUrl}
                    className="rounded-lg shadow-xl max-w-[250px]"
                  />
                )}
              </div>

              <div className="flex flex-col justify-center space-y-6">
                <div>
                  <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Now Showing</h2>
                  <h1 className="text-3xl font-bold md:text-5xl">{activeMovie.title}</h1>
                </div>

                <Separator />

                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="font-semibold text-lg">Rate this Movie</h3>
                    <p className="text-muted-foreground text-sm">Vote 0-10 when you have finished watching.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <Slider
                        value={rating}
                        onValueChange={setRating}
                        max={10}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-3xl font-bold w-12 text-center">{rating[0]}</span>
                    </div>

                    <Button onClick={submitVote} size="lg" className="w-full">
                      Submit Vote
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {state.phase !== 'SUBMISSION' && state.phase !== 'VETTING' && state.phase !== 'WATCHING' && (
        <div className="flex items-center justify-center min-h-[50vh]">
          <h1 className="text-2xl text-muted-foreground">Phase: {state.phase}</h1>
        </div>
      )}

      {/* History Section */}
      {data.history && data.history.length > 0 && (
        <div className="space-y-6 pt-12">
          <h2 className="text-2xl font-bold text-center">Hall of Fame</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.history.map((m: any) => (
              <Card key={m.id} className="overflow-hidden bg-muted/40 border-none hover:bg-muted/60 transition-colors">
                {m.coverUrl && (
                  <div className="aspect-[2/3] relative">
                    <img src={m.coverUrl} className="object-cover w-full h-full" />
                    {m.averageScore && (
                      <div className="absolute top-2 right-2">
                        <Badge variant="secondary" className="font-bold gap-1 shadow-lg bg-black/50 backdrop-blur text-white border-white/20">
                          ⭐ {m.averageScore}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}
                <CardContent className="p-4">
                  <h4 className="font-semibold line-clamp-1">{m.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">Week {m.weekNumber}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
