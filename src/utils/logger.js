import { db } from '../firebase.config';
import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

export async function logActivity(userId, title, type = 'Success') {
    try {
        await addDoc(collection(db, 'activities'), {
            userId,
            title,
            type,
            timestamp: serverTimestamp()
        });
    } catch (err) {
        console.error("Failed to log activity", err);
    }
}

export async function getActivities(userId) {
    try {
        const q = query(
            collection(db, 'activities'),
            where('userId', '==', userId),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate() || new Date()
        }));
    } catch (err) {
        console.error("Failed to fetch activities", err);
        return [];
    }
}
