import { useState, useRef } from 'react';
import { useListAudioProjects, useDeleteAudioProject, getListAudioProjectsQueryKey } from '@workspace/api-client-react';
import { useUploadAudio } from '@/hooks/use-upload-audio';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UploadCloud, Music, Clock, Calendar, Trash2, Loader2, Plus, AlertCircle } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

export default function Dashboard() {
  const [_, setLocation] = useLocation();
  const { data: projects, isLoading, isError } = useListAudioProjects();
  const deleteProject = useDeleteAudioProject();
  const uploadAudio = useUploadAudio();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/')) {
        handleUpload(file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files[0]);
    }
  };

  const handleUpload = (file: File) => {
    uploadAudio.mutate(file, {
      onSuccess: (project) => {
        setLocation(`/project/${project.id}`);
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 font-medium">Ready</Badge>;
      case 'processing':
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 font-medium flex gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing</Badge>;
      case 'done':
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20 font-medium">Done</Badge>;
      case 'error':
        return <Badge className="bg-destructive/10 text-destructive border-destructive/20 font-medium">Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-8 max-w-6xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <header className="mb-8">
        <h1 className="font-serif text-4xl text-foreground mb-2">Projects</h1>
        <p className="text-muted-foreground">Upload, master, and manage your high-fidelity audio tracks.</p>
      </header>

      {/* Upload Drop Zone */}
      <Card className={`border-dashed border-2 transition-all duration-300 bg-card/50 hover:bg-card/80 ${isDragging ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <CardContent className="p-0">
          <label 
            className="flex flex-col items-center justify-center py-16 cursor-pointer"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              className="hidden" 
              accept="audio/*" 
              ref={fileInputRef}
              onChange={handleFileSelect}
              disabled={uploadAudio.isPending}
            />
            {uploadAudio.isPending ? (
              <div className="flex flex-col items-center text-primary">
                <Loader2 className="w-12 h-12 mb-4 animate-spin" />
                <span className="text-lg font-medium">Uploading & Analyzing...</span>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-background border border-border flex items-center justify-center mb-4 text-muted-foreground group-hover:text-primary transition-colors hover-elevate">
                  <UploadCloud className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-medium text-foreground mb-2">Drag and drop audio file here</h3>
                <p className="text-sm text-muted-foreground mb-6">WAV, FLAC, AIFF, or MP3 up to 100MB</p>
                <Button className="font-medium bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" /> Select File
                </Button>
              </>
            )}
          </label>
        </CardContent>
      </Card>

      {/* Projects List */}
      <div>
        <h2 className="text-2xl font-serif text-foreground mb-6 flex items-center gap-2">
          <Music className="w-5 h-5 text-primary" /> Recent Sessions
        </h2>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="h-32 animate-pulse bg-card/50 border-border" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center bg-destructive/5 rounded-lg border border-destructive/20 text-destructive flex flex-col items-center">
            <AlertCircle className="w-8 h-8 mb-2" />
            <p>Failed to load projects. Please try again.</p>
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(project => (
              <Card 
                key={project.id} 
                className="group relative overflow-hidden transition-all duration-300 hover:border-primary/50 hover:bg-card hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary/0 group-hover:bg-primary transition-colors" />
                
                <Link href={`/project/${project.id}`} className="block p-5">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-medium text-lg text-foreground truncate pr-4" title={project.name}>
                      {project.name}
                    </h3>
                    <div className="flex-shrink-0">
                      {getStatusBadge(project.status)}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-auto pt-2">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(project.duration)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {format(new Date(project.createdAt), 'MMM d, yyyy')}
                    </div>
                  </div>
                </Link>

                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm('Delete this project?')) {
                      deleteProject.mutate({ id: project.id }, {
                        onSuccess: () => {
                          queryClient.invalidateQueries({ queryKey: getListAudioProjectsQueryKey() });
                        }
                      });
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-card/30 rounded-xl border border-border border-dashed">
            <div className="w-16 h-16 rounded-full bg-background border border-border flex items-center justify-center mx-auto mb-4 text-muted-foreground">
              <Music className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-xl font-serif text-foreground mb-2">No projects yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Your audio sessions will appear here. Upload a track above to begin mastering.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}