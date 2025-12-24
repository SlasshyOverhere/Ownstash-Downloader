// User Avatar component with fallback to initials
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
    photoURL?: string | null;
    displayName?: string | null;
    email?: string | null;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export function UserAvatar({ photoURL, displayName, email, size = 'md', className }: UserAvatarProps) {
    const [imageError, setImageError] = useState(false);

    // Get the initial letter
    const initial = (displayName || email || 'U').charAt(0).toUpperCase();

    // Check if we should show the image
    const hasValidPhoto = photoURL && photoURL.trim() !== '' && !imageError;

    // Size classes
    const sizeClasses = {
        sm: 'w-8 h-8 text-sm',
        md: 'w-10 h-10 text-lg',
        lg: 'w-16 h-16 text-2xl',
    };

    return (
        <div
            className={cn(
                'rounded-full bg-gradient-to-br from-white/90 to-white/60 flex items-center justify-center overflow-hidden flex-shrink-0',
                sizeClasses[size],
                className
            )}
        >
            {hasValidPhoto ? (
                <img
                    src={photoURL!}
                    alt=""
                    className="w-full h-full rounded-full object-cover"
                    onError={() => setImageError(true)}
                />
            ) : (
                <span className="font-bold text-black uppercase select-none">
                    {initial}
                </span>
            )}
        </div>
    );
}

export default UserAvatar;
