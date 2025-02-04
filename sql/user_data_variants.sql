CREATE TABLE user_data_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    variant_id TEXT NOT NULL,
    variant JSONB NOT NULL,
    moves JSONB DEFAULT '[]'::jsonb,
    updated_at BIGINT,
    UNIQUE(user_id, variant_id)
);


-- Enable Row Level Security
ALTER TABLE user_data_variants ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view own data" ON user_data_variants
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data" ON user_data_variants
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data" ON user_data_variants
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data" ON user_data_variants
    FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX user_data_variants_user_variant_idx 
ON user_data_variants(user_id, variant_id);    

CREATE INDEX user_data_variants_user_updated_idx 
ON user_data_variants(user_id, updated_at);


-- Grant necessary permissions
GRANT ALL ON user_data_variants TO authenticated;