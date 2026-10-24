import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { IComment, IMention } from '../models';

@Injectable({ providedIn: 'root' })
export class CommentService {
  private readonly http = inject(HttpClient);

  add(summaryId: string, content: string, mentions: IMention[]) {
    return this.http.put<IComment>('/api/comment', { content, mentions, summaryId });
  }

  delete(commentId: string, summaryId: string) {
    return this.http.delete(`/api/comment/${commentId}`, { body: { summaryId } });
  }
}
