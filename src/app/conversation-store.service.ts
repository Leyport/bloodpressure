import { Injectable } from '@angular/core';
import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Conversation } from './library.model';

/** Persists Gemini conversations to Firestore under users/{uid}/conversations. */
@Injectable({ providedIn: 'root' })
export class ConversationStoreService {
  private col(uid: string) {
    return collection(db, 'users', uid, 'conversations');
  }

  async list(uid: string): Promise<Conversation[]> {
    const snap = await getDocs(query(this.col(uid), orderBy('updatedAt', 'desc')));
    return snap.docs.map(d => ({ ...(d.data() as Omit<Conversation, 'id'>), id: d.id }));
  }

  async save(uid: string, convo: Conversation): Promise<void> {
    const { id, ...data } = convo;
    await setDoc(doc(this.col(uid), id), data);
  }

  async delete(uid: string, id: string): Promise<void> {
    await deleteDoc(doc(this.col(uid), id));
  }
}
